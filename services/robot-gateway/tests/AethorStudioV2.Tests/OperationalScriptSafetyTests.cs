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

        Assert.Equal(5, restCalls.Length);
        Assert.Single(restCalls, line => line.Contains("/health/live", StringComparison.Ordinal));
        Assert.Equal(2, restCalls.Count(line => line.Contains("/api/v1/session", StringComparison.Ordinal)));
        Assert.Single(restCalls, line => line.Contains("/api/v1/gateway/capabilities", StringComparison.Ordinal));
        Assert.Single(restCalls, line => line.Contains("/api/v1/serial/ports", StringComparison.Ordinal));
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
            "Invoke-WebRequest",
            "System.IO.Ports",
            "taskkill",
            "$env:ComSpec",
            "pnpm gateway:dev");
        Assert.DoesNotMatch(new Regex(@"\.Open\s*\(", RegexOptions.IgnoreCase), source);
        Assert.DoesNotMatch(new Regex(@"WriteAsync\s*\(", RegexOptions.IgnoreCase), source);
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
            "powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/smoke-offline.ps1",
            scripts.GetProperty("gateway:smoke:offline").GetString());
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
