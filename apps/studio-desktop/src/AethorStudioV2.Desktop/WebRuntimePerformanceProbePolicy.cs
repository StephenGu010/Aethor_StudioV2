using System.Text.Json;

namespace AethorStudioV2.Desktop;

public static class WebRuntimePerformanceProbePolicy
{
    public const string Prefix = "AETHOR_PERF_V1 ";
    private const double MaximumHeapBytes = 1_099_511_627_776d;
    private const double MaximumCount = 100_000_000d;
    private static readonly HashSet<string> RequiredMetricNames =
    [
        "JSHeapUsedSize",
        "JSHeapTotalSize",
        "Documents",
        "Nodes",
        "LayoutCount",
        "RecalcStyleCount"
    ];

    public static bool TryNormalize(
        string cdpMetricsJson,
        WebRuntimeProcessMemorySnapshot processMemory,
        WebRuntimeWorkspace workspace,
        bool visible,
        int sequence,
        out string? normalizedProbe)
    {
        normalizedProbe = null;
        if (string.IsNullOrWhiteSpace(cdpMetricsJson)
            || cdpMetricsJson.Length > 64 * 1024
            || !IsValidProcessMemory(processMemory)
            || !WebRuntimeWorkspaceClassifier.TryGetLogValue(workspace, out var workspaceValue)
            || sequence is < 1 or > 1_000_000)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(cdpMetricsJson, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8
            });
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("metrics", out var metrics)
                || metrics.ValueKind != JsonValueKind.Array
                || metrics.GetArrayLength() > 256)
            {
                return false;
            }

            var values = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var metric in metrics.EnumerateArray())
            {
                if (metric.ValueKind != JsonValueKind.Object
                    || !metric.TryGetProperty("name", out var nameElement)
                    || nameElement.ValueKind != JsonValueKind.String)
                {
                    return false;
                }

                var name = nameElement.GetString();
                if (name is null || !RequiredMetricNames.Contains(name)) continue;
                if (!metric.TryGetProperty("value", out var valueElement)
                    || valueElement.ValueKind != JsonValueKind.Number
                    || !valueElement.TryGetDouble(out var value)
                    || !double.IsFinite(value)
                    || !values.TryAdd(name, value))
                {
                    return false;
                }
            }

            if (values.Count != RequiredMetricNames.Count
                || !InRange(values["JSHeapUsedSize"], 0, MaximumHeapBytes)
                || !InRange(values["JSHeapTotalSize"], 0, MaximumHeapBytes)
                || values["JSHeapUsedSize"] > values["JSHeapTotalSize"]
                || !IsBoundedCount(values["Documents"])
                || !IsBoundedCount(values["Nodes"])
                || !IsBoundedCount(values["LayoutCount"])
                || !IsBoundedCount(values["RecalcStyleCount"]))
            {
                return false;
            }

            var payload = new PerformanceProbePayload(
                "desktop.runtime.performance.sampled",
                "completed",
                sequence,
                workspaceValue!,
                visible ? "visible" : "hidden",
                ToMiB(values["JSHeapUsedSize"]),
                ToMiB(values["JSHeapTotalSize"]),
                checked((int)values["Documents"]),
                checked((int)values["Nodes"]),
                checked((int)values["LayoutCount"]),
                checked((int)values["RecalcStyleCount"]),
                ToMiB(processMemory.DesktopWorkingSetBytes),
                processMemory.WebViewProcessCount,
                ToMiB(processMemory.WebViewWorkingSetBytes),
                processMemory.GatewayWorkingSetBytes is null
                    ? null
                    : ToMiB(processMemory.GatewayWorkingSetBytes.Value),
                ToMiB(processMemory.TrackedWorkingSetBytes));
            normalizedProbe = Prefix + JsonSerializer.Serialize(payload, SerializerOptions);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private static bool InRange(double value, double minimum, double maximum) =>
        value >= minimum && value <= maximum;

    private static bool IsBoundedCount(double value) =>
        InRange(value, 0, MaximumCount) && value == Math.Truncate(value);

    private static double ToMiB(double bytes) =>
        Math.Round(bytes / (1024d * 1024d), 1, MidpointRounding.AwayFromZero);

    private static bool IsValidProcessMemory(WebRuntimeProcessMemorySnapshot processMemory)
    {
        if (processMemory is null
            || processMemory.DesktopWorkingSetBytes is <= 0 or > WebRuntimeProcessMemorySampler.MaximumWorkingSetBytes
            || processMemory.WebViewProcessCount is < 1 or > WebRuntimeProcessMemorySampler.MaximumWebViewProcessCount
            || processMemory.WebViewWorkingSetBytes is <= 0 or > WebRuntimeProcessMemorySampler.MaximumWorkingSetBytes
            || processMemory.GatewayWorkingSetBytes is <= 0 or > WebRuntimeProcessMemorySampler.MaximumWorkingSetBytes
            || processMemory.TrackedWorkingSetBytes is <= 0 or > WebRuntimeProcessMemorySampler.MaximumWorkingSetBytes)
        {
            return false;
        }

        try
        {
            return processMemory.TrackedWorkingSetBytes == checked(
                processMemory.DesktopWorkingSetBytes
                + processMemory.WebViewWorkingSetBytes
                + (processMemory.GatewayWorkingSetBytes ?? 0));
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private sealed record PerformanceProbePayload(
        string EventId,
        string Outcome,
        int Sequence,
        string Workspace,
        string Visibility,
        double JsHeapUsedMiB,
        double JsHeapTotalMiB,
        int Documents,
        int Nodes,
        int LayoutCount,
        int RecalcStyleCount,
        double DesktopWorkingSetMiB,
        int WebViewProcessCount,
        double WebViewWorkingSetMiB,
        double? GatewayWorkingSetMiB,
        double TrackedWorkingSetMiB);

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
