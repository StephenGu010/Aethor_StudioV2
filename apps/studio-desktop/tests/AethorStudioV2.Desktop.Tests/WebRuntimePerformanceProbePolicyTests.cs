using System.Text.Json;

namespace AethorStudioV2.Desktop.Tests;

public sealed class WebRuntimePerformanceProbePolicyTests
{
    [Fact]
    public void NormalizesOnlyBoundedWhitelistedPerformanceFields()
    {
        var source = BuildMetricsJson(new Dictionary<string, double>
        {
            ["JSHeapUsedSize"] = 48 * 1024 * 1024,
            ["JSHeapTotalSize"] = 80 * 1024 * 1024,
            ["Documents"] = 2,
            ["Nodes"] = 4321,
            ["LayoutCount"] = 17,
            ["RecalcStyleCount"] = 22,
            ["Timestamp"] = 123456
        }, new { access_token = "must-not-leak" });

        Assert.True(WebRuntimePerformanceProbePolicy.TryNormalize(
            source,
            ProcessMemory(),
            WebRuntimeWorkspace.Console,
            visible: true,
            sequence: 7,
            out var normalized));
        Assert.StartsWith(WebRuntimePerformanceProbePolicy.Prefix, normalized, StringComparison.Ordinal);
        Assert.Contains("\"jsHeapUsedMiB\":48", normalized, StringComparison.Ordinal);
        Assert.Contains("\"desktopWorkingSetMiB\":96", normalized, StringComparison.Ordinal);
        Assert.Contains("\"webViewProcessCount\":4", normalized, StringComparison.Ordinal);
        Assert.Contains("\"webViewWorkingSetMiB\":384", normalized, StringComparison.Ordinal);
        Assert.Contains("\"gatewayWorkingSetMiB\":48", normalized, StringComparison.Ordinal);
        Assert.Contains("\"trackedWorkingSetMiB\":528", normalized, StringComparison.Ordinal);
        Assert.Contains("\"workspace\":\"console\"", normalized, StringComparison.Ordinal);
        Assert.Contains("\"visibility\":\"visible\"", normalized, StringComparison.Ordinal);
        Assert.DoesNotContain("Timestamp", normalized, StringComparison.Ordinal);
        Assert.DoesNotContain("access_token", normalized, StringComparison.Ordinal);
        Assert.DoesNotContain("must-not-leak", normalized, StringComparison.Ordinal);
    }

    [Fact]
    public void NormalizesAnOfflineDesktopWithoutAGatewayProcess()
    {
        var offlineMemory = ProcessMemory() with
        {
            GatewayWorkingSetBytes = null,
            TrackedWorkingSetBytes = 480 * 1024 * 1024
        };

        Assert.True(WebRuntimePerformanceProbePolicy.TryNormalize(
            JsonSerializer.Serialize(new { metrics = RequiredMetrics() }),
            offlineMemory,
            WebRuntimeWorkspace.Terminal,
            visible: false,
            sequence: 1,
            out var normalized));

        Assert.Contains("\"gatewayWorkingSetMiB\":null", normalized, StringComparison.Ordinal);
        Assert.Contains("\"trackedWorkingSetMiB\":480", normalized, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"metrics\":[]}")]
    [InlineData("not-json")]
    public void RejectsMissingOrMalformedMetricSets(string source)
    {
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            source,
            ProcessMemory(),
            WebRuntimeWorkspace.Unknown,
            visible: false,
            sequence: 1,
            out var normalized));
        Assert.Null(normalized);
    }

    [Fact]
    public void RejectsDuplicateRequiredMetricsAndImpossibleHeapRelationships()
    {
        var duplicate = JsonSerializer.Serialize(new
        {
            metrics = RequiredMetrics().Append(new { name = "Nodes", value = 3d })
        });
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            duplicate, ProcessMemory(), WebRuntimeWorkspace.Console, true, 1, out _));

        var impossible = BuildMetricsJson(new Dictionary<string, double>
        {
            ["JSHeapUsedSize"] = 20,
            ["JSHeapTotalSize"] = 10,
            ["Documents"] = 1,
            ["Nodes"] = 1,
            ["LayoutCount"] = 1,
            ["RecalcStyleCount"] = 1
        });
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            impossible, ProcessMemory(), WebRuntimeWorkspace.Console, true, 1, out _));
    }

    [Fact]
    public void RejectsUnboundedOrNonIntegralCountsAndInvalidHostInputs()
    {
        var fractional = BuildMetricsJson(new Dictionary<string, double>
        {
            ["JSHeapUsedSize"] = 10,
            ["JSHeapTotalSize"] = 20,
            ["Documents"] = 1,
            ["Nodes"] = 1.5,
            ["LayoutCount"] = 1,
            ["RecalcStyleCount"] = 1
        });
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            fractional, ProcessMemory(), WebRuntimeWorkspace.Console, true, 1, out _));

        var valid = JsonSerializer.Serialize(new { metrics = RequiredMetrics() });
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            valid, ProcessMemory() with { WebViewProcessCount = 0 }, WebRuntimeWorkspace.Console, true, 1, out _));
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            valid, ProcessMemory() with { TrackedWorkingSetBytes = 1 }, WebRuntimeWorkspace.Console, true, 1, out _));
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            valid, ProcessMemory(), WebRuntimeWorkspace.Console, true, 0, out _));
        Assert.False(WebRuntimePerformanceProbePolicy.TryNormalize(
            valid, ProcessMemory(), (WebRuntimeWorkspace)999, true, 1, out _));
    }

    private static object[] RequiredMetrics() =>
    [
        new { name = "JSHeapUsedSize", value = 10d },
        new { name = "JSHeapTotalSize", value = 20d },
        new { name = "Documents", value = 1d },
        new { name = "Nodes", value = 2d },
        new { name = "LayoutCount", value = 3d },
        new { name = "RecalcStyleCount", value = 4d }
    ];

    private static string BuildMetricsJson(
        IReadOnlyDictionary<string, double> values,
        object? extra = null) =>
        JsonSerializer.Serialize(new
        {
            metrics = values.Select(pair => new { name = pair.Key, value = pair.Value }),
            extra
        });

    private static WebRuntimeProcessMemorySnapshot ProcessMemory() => new(
        DesktopWorkingSetBytes: 96 * 1024 * 1024,
        WebViewProcessCount: 4,
        WebViewWorkingSetBytes: 384 * 1024 * 1024,
        GatewayWorkingSetBytes: 48 * 1024 * 1024,
        TrackedWorkingSetBytes: 528 * 1024 * 1024);
}
