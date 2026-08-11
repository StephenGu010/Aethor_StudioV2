namespace AethorStudioV2.Desktop.Tests;

public sealed class WebRuntimeProcessMemorySamplerTests
{
    [Fact]
    public void AggregatesUniqueObservedProcessesWithoutRetainingIdentities()
    {
        var workingSets = new Dictionary<int, long?>
        {
            [1] = 100,
            [2] = 200,
            [3] = 300,
            [4] = 50
        };

        Assert.True(WebRuntimeProcessMemorySampler.TryCapture(
            desktopProcessId: 1,
            webViewProcessIds: [2, 3, 3],
            gatewayProcessId: 4,
            workingSets.GetValueOrDefault,
            out var snapshot));

        Assert.Equal(new WebRuntimeProcessMemorySnapshot(100, 2, 500, 50, 650), snapshot);
    }

    [Fact]
    public void OmitsWebViewProcessesThatExitAfterTheEnvironmentSnapshot()
    {
        var workingSets = new Dictionary<int, long?>
        {
            [1] = 100,
            [2] = null,
            [3] = 300
        };

        Assert.True(WebRuntimeProcessMemorySampler.TryCapture(
            1,
            [2, 3],
            gatewayProcessId: null,
            workingSets.GetValueOrDefault,
            out var snapshot));

        Assert.Equal(new WebRuntimeProcessMemorySnapshot(100, 1, 300, null, 400), snapshot);
    }

    [Fact]
    public void RejectsMissingRequiredProcessesAndIdentityOverlap()
    {
        static long? MissingWebView(int processId) => processId == 1 ? 100 : null;

        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1, [2], null, MissingWebView, out _));
        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1, [1], null, _ => 100, out _));
        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1, [2], 2, _ => 100, out _));
        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1, [2], 3, processId => processId == 3 ? null : 100, out _));
    }

    [Fact]
    public void RejectsUnboundedProcessListsAndWorkingSets()
    {
        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1,
            Enumerable.Range(2, WebRuntimeProcessMemorySampler.MaximumWebViewProcessCount + 1),
            null,
            _ => 100,
            out _));
        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1,
            [2],
            null,
            processId => processId == 2 ? -1 : 100,
            out _));
        Assert.False(WebRuntimeProcessMemorySampler.TryCapture(
            1,
            [2],
            null,
            _ => WebRuntimeProcessMemorySampler.MaximumWorkingSetBytes,
            out _));
    }
}
