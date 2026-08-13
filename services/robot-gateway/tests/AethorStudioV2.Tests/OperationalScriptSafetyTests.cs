using System.Text.Json;
using System.Text.RegularExpressions;

namespace AethorStudioV2.Tests;

public sealed class OperationalScriptSafetyTests
{
    [Fact]
    public void EnumerationOnlyPreflightHasNoConnectionOrNetworkCapability()
    {
        var source = ReadOperationFile("preflight-readonly.ps1");

        Assert.Contains("operation = 'enumeration-only'", source, StringComparison.Ordinal);
        Assert.Contains("serialPortOpened = $false", source, StringComparison.Ordinal);
        Assert.Contains("networkRequestSent = $false", source, StringComparison.Ordinal);
        AssertForbidden(
            source,
            "Start-Process",
            "Stop-Process",
            "Invoke-RestMethod",
            "Invoke-WebRequest",
            "HttpClient",
            "System.IO.Ports",
            "/session/connect");
        Assert.DoesNotMatch(new Regex(@"\.Open\s*\(", RegexOptions.IgnoreCase), source);
        Assert.DoesNotMatch(new Regex(@"new\s+.*SerialPort", RegexOptions.IgnoreCase), source);
    }

    [Fact]
    public void OfflineSmokeUsesOnlyApprovedLoopbackReadsAndExactProcessCleanup()
    {
        var source = ReadOperationFile("smoke-offline.ps1");
        var restCalls = source
            .Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Where(line =>
                !line.StartsWith('#') &&
                line.Contains("Invoke-RestMethod", StringComparison.Ordinal))
            .ToArray();
        var webCalls = source
            .Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Where(line =>
                !line.StartsWith('#') &&
                line.Contains("Invoke-WebRequest", StringComparison.Ordinal))
            .ToArray();

        Assert.Equal(5, restCalls.Length);
        Assert.Single(restCalls, line => line.Contains("/health/live", StringComparison.Ordinal));
        Assert.Equal(2, restCalls.Count(line => line.Contains("/api/v1/session", StringComparison.Ordinal)));
        Assert.Single(restCalls, line => line.Contains("/api/v1/gateway/capabilities", StringComparison.Ordinal));
        Assert.Single(restCalls, line => line.Contains("/api/v1/serial/ports", StringComparison.Ordinal));
        Assert.Single(webCalls);
        Assert.Contains("\"$baseUrl/hubs/robot-v1/negotiate?negotiateVersion=1\"", source, StringComparison.Ordinal);
        Assert.Contains("-Method Options", source, StringComparison.Ordinal);
        Assert.Contains(
            "'Access-Control-Request-Headers' = 'authorization,x-requested-with,x-signalr-user-agent'",
            source,
            StringComparison.Ordinal);
        Assert.Contains("$baseUrl = \"http://127.0.0.1:$GatewayPort\"", source, StringComparison.Ordinal);
        Assert.Contains("serialConnectRequested = $false", source, StringComparison.Ordinal);
        Assert.Contains("Stop-Process -Id $gatewayProcess.Id -Force", source, StringComparison.Ordinal);
        Assert.Contains("[object[]]$ports = @(", source, StringComparison.Ordinal);
        Assert.Contains("$portsResponse.PSObject.Properties.Name -contains 'value'", source, StringComparison.Ordinal);
        Assert.Contains("$portsResponse.value", source, StringComparison.Ordinal);
        Assert.DoesNotContain("@(Invoke-RestMethod", source, StringComparison.Ordinal);
        AssertForbidden(
            source,
            "/session/connect",
            "System.IO.Ports",
            "taskkill",
            "$env:ComSpec",
            "pnpm gateway:dev");
        Assert.DoesNotMatch(new Regex(@"\.Open\s*\(", RegexOptions.IgnoreCase), source);
        Assert.DoesNotMatch(new Regex(@"WriteAsync\s*\(", RegexOptions.IgnoreCase), source);
    }

    [Fact]
    public void ControlPreflightCannotStartGatewayConnectSerialOrCallCommandApis()
    {
        var source = ReadOperationFile("preflight-control.ps1");

        Assert.Contains("operation = 'enumeration-and-config-inspection-only'", source, StringComparison.Ordinal);
        Assert.Contains("hardwareAccessAuthorized = $false", source, StringComparison.Ordinal);
        Assert.Contains("gatewayStarted = $false", source, StringComparison.Ordinal);
        Assert.Contains("serialPortOpened = $false", source, StringComparison.Ordinal);
        Assert.Contains("networkRequestSent = $false", source, StringComparison.Ordinal);
        Assert.Contains("'supervised-policy-not-armed'", source, StringComparison.Ordinal);
        Assert.Contains("'desktop-token-source-not-armed'", source, StringComparison.Ordinal);
        Assert.Contains("'session-token-not-reused'", source, StringComparison.Ordinal);
        Assert.Contains("'unverified-speed-not-armed'", source, StringComparison.Ordinal);
        Assert.Contains("'unverified-completion-policy-not-armed'", source, StringComparison.Ordinal);
        Assert.Contains("AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG", source, StringComparison.Ordinal);
        Assert.Contains("AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS", source, StringComparison.Ordinal);
        Assert.Contains("AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS", source, StringComparison.Ordinal);
        Assert.Contains("preflight-readonly.ps1", source, StringComparison.Ordinal);
        Assert.Contains("AethorStudioV2.Domain.dll", source, StringComparison.Ordinal);
        Assert.Contains("AethorStudioV2.Application.dll", source, StringComparison.Ordinal);
        Assert.Contains("AethorStudioV2.Infrastructure.dll", source, StringComparison.Ordinal);
        Assert.Contains("AethorStudioV2.Api.dll", source, StringComparison.Ordinal);
        Assert.Contains("releaseArtifacts = $releaseArtifacts", source, StringComparison.Ordinal);
        Assert.Contains("releaseArtifactManifestSha256 = $artifactManifestHash", source, StringComparison.Ordinal);
        AssertForbidden(
            source,
            "Start-Process",
            "Stop-Process",
            "Invoke-RestMethod",
            "Invoke-WebRequest",
            "HttpClient",
            "System.IO.Ports",
            "/session/connect",
            "/commands/");
        Assert.DoesNotMatch(new Regex(@"\.Open\s*\(", RegexOptions.IgnoreCase), source);
        Assert.DoesNotMatch(new Regex(@"WriteAsync\s*\(", RegexOptions.IgnoreCase), source);
    }

    [Fact]
    public void ReadOnlySoakIsExplicitlyAuthorizedCommandDisabledAndBounded()
    {
        var source = ReadOperationFile("soak-readonly.ps1");

        Assert.Contains("$requiredAuthorizationPhrase = 'AUTHORIZE DUMMY READ-ONLY SOAK'", source, StringComparison.Ordinal);
        Assert.Contains("[switch]$WorkspaceClear", source, StringComparison.Ordinal);
        Assert.Contains("[switch]$PhysicalEmergencyStopReachable", source, StringComparison.Ordinal);
        Assert.Contains("[switch]$RobotStationary", source, StringComparison.Ordinal);
        Assert.Contains("[switch]$MotorDisabledExpected", source, StringComparison.Ordinal);
        Assert.Contains("[switch]$AcknowledgeReadOnlyQueries", source, StringComparison.Ordinal);
        Assert.Contains("[ValidateRange(60, 14400)]", source, StringComparison.Ordinal);
        Assert.Contains("[ValidateRange(1, 10)]", source, StringComparison.Ordinal);
        Assert.Contains("$profileId = 'dummy-6dof'", source, StringComparison.Ordinal);
        Assert.Contains("$allowedQueries = @('#GETJPOS', '#GETMODE', '#GETENABLE')", source, StringComparison.Ordinal);
        Assert.Contains("$env:AETHOR_GATEWAY_COMMAND_POLICY = 'disabled'", source, StringComparison.Ordinal);
        Assert.Contains("@($capabilities.supportedCommands).Count -ne 0", source, StringComparison.Ordinal);
        Assert.Contains("/api/v1/session/connect", source, StringComparison.Ordinal);
        Assert.Contains("/api/v1/session/disconnect", source, StringComparison.Ordinal);
        Assert.Contains("/api/v1/host/shutdown", source, StringComparison.Ordinal);
        Assert.Contains("Stop-Process -Id $gatewayProcess.Id -Force", source, StringComparison.Ordinal);
        Assert.Contains("operation = 'validation-only'", source, StringComparison.Ordinal);
        Assert.Contains("filesystemMutationPerformed = $false", source, StringComparison.Ordinal);
        Assert.Contains("resourceAcceptanceEvaluated = $false", source, StringComparison.Ordinal);
        Assert.Contains("browserHeapCaptured = $false", source, StringComparison.Ordinal);
        Assert.Contains("hardwareFaultInjectionPerformed = $false", source, StringComparison.Ordinal);
        Assert.Contains("phase7bCompleted = $false", source, StringComparison.Ordinal);
        Assert.Contains("evidenceCollectionPassed = $false", source, StringComparison.Ordinal);
        Assert.Contains("function ConvertTo-ResponseArray", source, StringComparison.Ordinal);
        Assert.Contains("$Response.PSObject.Properties.Name -contains 'value'", source, StringComparison.Ordinal);
        Assert.True(
            source.IndexOf("if ($ValidateOnly)", StringComparison.Ordinal) <
            source.IndexOf("New-Item -ItemType Directory", StringComparison.Ordinal));
        AssertForbidden(
            source,
            "/commands/",
            "System.IO.Ports",
            "WriteAsync",
            "AETHOR_GATEWAY_COMMAND_POLICY = 'supervised'",
            "taskkill",
            "$env:ComSpec");
        Assert.DoesNotMatch(new Regex(@"new\s+.*SerialPort", RegexOptions.IgnoreCase), source);
    }

    [Fact]
    public void RootPackageExposesOnlyTheReviewedOperationalEntrypoints()
    {
        using var document = JsonDocument.Parse(ReadOperationFile("package.json"));
        var scripts = document.RootElement.GetProperty("scripts");

        Assert.Equal(
            "powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/preflight-readonly.ps1",
            scripts.GetProperty("gateway:preflight").GetString());
        Assert.Equal(
            "powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/preflight-control.ps1",
            scripts.GetProperty("gateway:preflight:control").GetString());
        Assert.Equal(
            "powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/smoke-offline.ps1",
            scripts.GetProperty("gateway:smoke:offline").GetString());
        Assert.Equal(
            "powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/soak-readonly.ps1",
            scripts.GetProperty("gateway:soak:readonly").GetString());
        Assert.Equal(
            "powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/start-engineering-dev.ps1",
            scripts.GetProperty("dev:engineering").GetString());
        Assert.Contains("dotnet-isolated.ps1 gateway test", scripts.GetProperty("gateway:test").GetString(), StringComparison.Ordinal);
        Assert.Contains("dotnet-isolated.ps1 desktop test", scripts.GetProperty("desktop:test").GetString(), StringComparison.Ordinal);
        Assert.Contains("gateway:build:verify", scripts.GetProperty("build").GetString(), StringComparison.Ordinal);
        Assert.Contains("desktop:build:verify", scripts.GetProperty("build").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public void DotnetVerificationUsesUniqueOwnedArtifactsAndAlwaysCleansThem()
    {
        var source = ReadOperationFile("dotnet-isolated.ps1");

        Assert.Contains("artifacts\\validation\\dotnet", source, StringComparison.Ordinal);
        Assert.Contains(".run-$scopeCode-$PID-", source, StringComparison.Ordinal);
        Assert.Contains("--artifacts-path $runRoot", source, StringComparison.Ordinal);
        Assert.Contains("Assert-OwnedRunPath", source, StringComparison.Ordinal);
        Assert.Contains("[IO.Directory]::Delete($extendedPath, $true)", source, StringComparison.Ordinal);
        Assert.Contains("Remove-OwnedRunDirectory $runRoot $artifactParent", source, StringComparison.Ordinal);
        Assert.Contains("artifactsCleaned = $true", source, StringComparison.Ordinal);
        Assert.Contains("serialPortOpened = $false", source, StringComparison.Ordinal);
        Assert.Contains("hardwareCommandSent = $false", source, StringComparison.Ordinal);
        AssertForbidden(
            source,
            "Stop-Process",
            "taskkill",
            "$env:ComSpec",
            "System.IO.Ports",
            "/session/connect",
            "/commands/");
    }

    [Fact]
    public void EngineeringDevelopmentEntryStartsOfflineWithoutSerialOrCommandRequests()
    {
        var source = ReadOperationFile("start-engineering-dev.ps1");

        Assert.Contains("$env:AETHOR_GATEWAY_COMMAND_POLICY = 'engineering'", source, StringComparison.Ordinal);
        Assert.Contains("$capabilities.contractVersion -ne '1.4'", source, StringComparison.Ordinal);
        Assert.Contains("$capabilities.commandPolicy -ne 'engineering'", source, StringComparison.Ordinal);
        Assert.Contains("-not $capabilities.directCommand", source, StringComparison.Ordinal);
        Assert.Contains("$session.connectionState -ne 'offline'", source, StringComparison.Ordinal);
        Assert.Contains("Loopback port $GatewayPort is already in use", source, StringComparison.Ordinal);
        Assert.True(
            source.IndexOf("if (Get-LoopbackListener $GatewayPort)", StringComparison.Ordinal) <
            source.IndexOf("$gateway = Start-Process", StringComparison.Ordinal));
        AssertForbidden(
            source,
            "/session/connect",
            "/session/disconnect",
            "/commands/",
            "/engineering/direct-command",
            "System.IO.Ports",
            "WriteAsync",
            "Stop-Process",
            "taskkill",
            "$env:ComSpec");
        Assert.DoesNotMatch(new Regex(@"\.Open\s*\(", RegexOptions.IgnoreCase), source);
    }

    private static string ReadOperationFile(string fileName) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Operations", fileName));

    private static void AssertForbidden(string source, params string[] forbiddenValues)
    {
        foreach (var forbiddenValue in forbiddenValues)
        {
            Assert.DoesNotContain(forbiddenValue, source, StringComparison.OrdinalIgnoreCase);
        }
    }
}
