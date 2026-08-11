namespace AethorStudioV2.Desktop;

public sealed record WebRuntimeProcessMemorySnapshot(
    long DesktopWorkingSetBytes,
    int WebViewProcessCount,
    long WebViewWorkingSetBytes,
    long? GatewayWorkingSetBytes,
    long TrackedWorkingSetBytes);

public static class WebRuntimeProcessMemorySampler
{
    public const int MaximumWebViewProcessCount = 256;
    public const long MaximumWorkingSetBytes = 17_592_186_044_416L;

    public static bool TryCapture(
        int desktopProcessId,
        IEnumerable<int> webViewProcessIds,
        int? gatewayProcessId,
        Func<int, long?> workingSetReader,
        out WebRuntimeProcessMemorySnapshot? snapshot)
    {
        snapshot = null;
        if (desktopProcessId <= 0
            || webViewProcessIds is null
            || workingSetReader is null
            || gatewayProcessId is <= 0
            || gatewayProcessId == desktopProcessId)
        {
            return false;
        }

        var desktopWorkingSet = workingSetReader(desktopProcessId);
        if (!IsValidWorkingSet(desktopWorkingSet)) return false;
        var desktopWorkingSetBytes = desktopWorkingSet.GetValueOrDefault();

        var observedProcessIds = new HashSet<int>();
        var observedWebViewProcessCount = 0;
        long webViewWorkingSet = 0;
        try
        {
            foreach (var processId in webViewProcessIds)
            {
                if (processId <= 0
                    || processId == desktopProcessId
                    || processId == gatewayProcessId)
                {
                    return false;
                }
                if (!observedProcessIds.Add(processId)) continue;
                if (observedProcessIds.Count > MaximumWebViewProcessCount) return false;

                var processWorkingSet = workingSetReader(processId);
                if (processWorkingSet is null) continue;
                if (!IsValidWorkingSet(processWorkingSet)) return false;
                webViewWorkingSet = checked(webViewWorkingSet + processWorkingSet.Value);
                observedWebViewProcessCount += 1;
            }

            if (observedWebViewProcessCount == 0 || webViewWorkingSet <= 0) return false;

            long? gatewayWorkingSet = null;
            if (gatewayProcessId is not null)
            {
                gatewayWorkingSet = workingSetReader(gatewayProcessId.Value);
                if (!IsValidWorkingSet(gatewayWorkingSet)) return false;
            }

            var trackedWorkingSet = checked(desktopWorkingSetBytes + webViewWorkingSet + (gatewayWorkingSet ?? 0));
            if (trackedWorkingSet > MaximumWorkingSetBytes) return false;

            snapshot = new(
                desktopWorkingSetBytes,
                observedWebViewProcessCount,
                webViewWorkingSet,
                gatewayWorkingSet,
                trackedWorkingSet);
            return true;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private static bool IsValidWorkingSet(long? bytes) =>
        bytes is > 0 and <= MaximumWorkingSetBytes;
}
