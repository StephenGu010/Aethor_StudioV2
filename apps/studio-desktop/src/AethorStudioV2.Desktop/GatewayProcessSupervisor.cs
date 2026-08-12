using System.Diagnostics;
using System.Net;
using System.Text.Json.Serialization;

namespace AethorStudioV2.Desktop;

public sealed record GatewayRuntimeSession(Uri BaseUri, string SessionToken, int ProcessId);

public sealed record GatewayStartResult(GatewayRuntimeSession? Session, string? Failure)
{
    public bool Started => Session is not null;
}

public sealed class GatewayProcessSupervisor : IAsyncDisposable
{
    private const int MaximumStartAttempts = 3;
    private readonly string executablePath;
    private readonly TimeSpan startupTimeout;
    private readonly DesktopGatewayMode gatewayMode;
    private readonly BoundedLogFile log;
    private readonly Func<int> allocatePort;
    private readonly HttpClient httpClient;
    private Process? process;
    private WindowsJobObject? job;
    private GatewayRuntimeSession? session;
    private int shutdownAccepted;

    public GatewayProcessSupervisor(
        string executablePath,
        TimeSpan startupTimeout,
        BoundedLogFile log,
        DesktopGatewayMode gatewayMode = DesktopGatewayMode.Disabled,
        Func<int>? allocatePort = null)
    {
        this.executablePath = Path.GetFullPath(executablePath);
        this.startupTimeout = startupTimeout;
        this.log = log;
        this.gatewayMode = gatewayMode;
        this.allocatePort = allocatePort ?? LoopbackPortAllocator.GetAvailablePort;
        httpClient = new HttpClient(BuildLoopbackHttpHandler(), disposeHandler: true)
        {
            Timeout = TimeSpan.FromSeconds(1)
        };
    }

    public event EventHandler? UnexpectedExit;
    public GatewayRuntimeSession? Session => session;

    public static SocketsHttpHandler BuildLoopbackHttpHandler() => new()
    {
        // The desktop talks only to the child process it owns. Environment or
        // system proxies must never intercept readiness or safe-shutdown calls.
        UseProxy = false,
        AllowAutoRedirect = false
    };

    public async Task<GatewayStartResult> TryStartAsync(CancellationToken cancellationToken)
    {
        if (process is not null) throw new InvalidOperationException("Gateway process already started");
        if (!File.Exists(executablePath)) return new(null, "网关程序不存在，已进入离线展示模式");

        var token = SessionTokenFactory.Create();
        log.RegisterSecret(token);
        string? lastFailure = null;
        for (var attempt = 1; attempt <= MaximumStartAttempts; attempt += 1)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var port = allocatePort();
            var baseUri = new Uri($"http://127.0.0.1:{port}", UriKind.Absolute);
            WindowsJobObject? candidateJob = null;
            Process? candidate = null;
            var candidateStarted = false;
            try
            {
                candidateJob = new WindowsJobObject();
                candidate = new Process
                {
                    StartInfo = BuildStartInfo(executablePath, port, token, gatewayMode),
                    EnableRaisingEvents = true
                };
                candidate.OutputDataReceived += (_, eventArgs) =>
                {
                    if (eventArgs.Data is { } line) log.Write("gateway.stdout", line);
                };
                candidate.ErrorDataReceived += (_, eventArgs) =>
                {
                    if (eventArgs.Data is { } line) log.Write("gateway.stderr", line);
                };
                if (!candidate.Start()) throw new InvalidOperationException("Gateway process did not start");
                candidateStarted = true;
                candidateJob.Assign(candidate);
                candidate.BeginOutputReadLine();
                candidate.BeginErrorReadLine();
                if (await WaitUntilReadyAsync(candidate, baseUri, cancellationToken).ConfigureAwait(false))
                {
                    process = candidate;
                    job = candidateJob;
                    session = new(baseUri, token, candidate.Id);
                    candidate.Exited += HandleUnexpectedExit;
                    log.Write("desktop", $"Gateway ready on loopback port {port}; pid={candidate.Id}");
                    candidate = null;
                    candidateJob = null;
                    return new(session, null);
                }

                lastFailure = candidate.HasExited
                    ? $"网关提前退出（code {candidate.ExitCode}）"
                    : "网关健康检查超时";
                StopCandidate(candidate, candidateJob, candidateStarted);
                candidate = null;
                candidateJob = null;
            }
            catch (OperationCanceledException)
            {
                StopCandidate(candidate, candidateJob, candidateStarted);
                throw;
            }
            catch (Exception exception)
            {
                StopCandidate(candidate, candidateJob, candidateStarted);
                lastFailure = $"网关启动失败：{exception.Message}";
                log.Write("desktop", $"Gateway start attempt {attempt} failed: {exception.GetType().Name}: {exception.Message}");
            }
        }

        return new(null, $"{lastFailure ?? "网关未就绪"}；已进入离线展示模式");
    }

    public async Task<bool> TryShutdownAsync(CancellationToken cancellationToken)
    {
        var activeProcess = process;
        var activeSession = session;
        if (activeProcess is null) return true;
        if (activeProcess.HasExited)
        {
            var canExit = GatewayShutdownSafetyPolicy.CanExitAfterGatewayTermination(
                gatewayProcessWasStarted: true,
                hostShutdownAccepted: Volatile.Read(ref shutdownAccepted) != 0);
            if (!canExit)
            {
                log.Write("desktop", "Gateway already exited without a host-confirmed safe shutdown; close remains blocked");
            }
            return canExit;
        }
        if (activeSession is null) return false;

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(activeSession.BaseUri, "/api/v1/host/shutdown"));
            request.Headers.Add("X-Aethor-Session", activeSession.SessionToken);
            using var response = await httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                log.Write("desktop", "Gateway shutdown rejected because device disable state is not confirmed");
                return false;
            }
            if (response.StatusCode != HttpStatusCode.Accepted)
            {
                log.Write("desktop", $"Gateway shutdown returned HTTP {(int)response.StatusCode}");
                return false;
            }

            Interlocked.Exchange(ref shutdownAccepted, 1);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            try
            {
                await activeProcess.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                activeProcess.Kill(entireProcessTree: true);
                await activeProcess.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
            }
            log.Write("desktop", "Gateway process stopped and released");
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            if (activeProcess.HasExited && Volatile.Read(ref shutdownAccepted) != 0) return true;
            if (activeProcess.HasExited)
            {
                log.Write("desktop", "Gateway exited while safe shutdown was unconfirmed; close remains blocked");
                return false;
            }
            log.Write("desktop", $"Gateway shutdown failed closed: {exception.GetType().Name}: {exception.Message}");
            return false;
        }
    }

    public static ProcessStartInfo BuildStartInfo(
        string executablePath,
        int port,
        string token,
        DesktopGatewayMode gatewayMode = DesktopGatewayMode.Disabled)
    {
        if (port is < 1024 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        if (token.Length is < 32 or > 256 || token.Any(character => character is < (char)0x21 or > (char)0x7e))
        {
            throw new ArgumentException("Session token does not satisfy the gateway contract", nameof(token));
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = Path.GetFullPath(executablePath),
            WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(executablePath))!,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        var inherited = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "DOTNET_ROOT" })
        {
            inherited[name] = Environment.GetEnvironmentVariable(name);
        }
        startInfo.Environment.Clear();
        foreach (var item in inherited.Where(item => !string.IsNullOrWhiteSpace(item.Value)))
        {
            startInfo.Environment[item.Key] = item.Value!;
        }
        var engineering = gatewayMode == DesktopGatewayMode.Engineering;
        startInfo.Environment["ASPNETCORE_ENVIRONMENT"] = engineering ? "Development" : "Production";
        startInfo.Environment["AETHOR_GATEWAY_PORT"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startInfo.Environment["AETHOR_GATEWAY_SESSION_TOKEN"] = token;
        startInfo.Environment["AETHOR_GATEWAY_TOKEN_SOURCE"] = engineering ? "development" : "desktop";
        startInfo.Environment["AETHOR_GATEWAY_COMMAND_POLICY"] = engineering ? "engineering" : "disabled";
        startInfo.Environment["AETHOR_GATEWAY_DEV_ORIGINS"] = "http://localhost";
        if (engineering)
        {
        }
        return startInfo;
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            await TryShutdownAsync(timeout.Token).ConfigureAwait(false);
        }
        catch
        {
            // Closing the job handle below is the crash-safety fallback.
        }
        process?.Dispose();
        job?.Dispose();
        httpClient.Dispose();
    }

    private async Task<bool> WaitUntilReadyAsync(Process candidate, Uri baseUri, CancellationToken cancellationToken)
    {
        using var startup = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        startup.CancelAfter(startupTimeout);
        while (!startup.IsCancellationRequested && !candidate.HasExited)
        {
            try
            {
                using var response = await httpClient.GetAsync(new Uri(baseUri, "/health/ready"), startup.Token).ConfigureAwait(false);
                if (response.IsSuccessStatusCode) return true;
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
            {
                if (cancellationToken.IsCancellationRequested) cancellationToken.ThrowIfCancellationRequested();
            }
            try
            {
                await Task.Delay(100, startup.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return false;
            }
        }
        return false;
    }

    private void HandleUnexpectedExit(object? sender, EventArgs eventArgs)
    {
        if (Volatile.Read(ref shutdownAccepted) != 0) return;
        log.Write("desktop", "Gateway exited unexpectedly; the UI must remain offline until a new desktop session starts");
        UnexpectedExit?.Invoke(this, EventArgs.Empty);
    }

    private void StopCandidate(Process? candidate, WindowsJobObject? candidateJob, bool candidateStarted)
    {
        try
        {
            if (candidate is not null && candidateStarted)
            {
                if (!candidate.HasExited) candidate.Kill(entireProcessTree: true);
                candidate.WaitForExit(5_000);
            }
        }
        catch (Exception exception)
        {
            log.Write("desktop", $"Gateway candidate cleanup warning: {exception.GetType().Name}: {exception.Message}");
        }
        finally
        {
            try { candidate?.Dispose(); } catch (Exception exception) { log.Write("desktop", $"Gateway process dispose warning: {exception.GetType().Name}"); }
            try { candidateJob?.Dispose(); } catch (Exception exception) { log.Write("desktop", $"Gateway job dispose warning: {exception.GetType().Name}"); }
        }
    }
}
