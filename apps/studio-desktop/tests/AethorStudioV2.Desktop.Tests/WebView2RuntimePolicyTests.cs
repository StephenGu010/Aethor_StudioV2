using Microsoft.Web.WebView2.Core;

namespace AethorStudioV2.Desktop.Tests;

public sealed class WebView2RuntimePolicyTests
{
    [Fact]
    public void EnvironmentOptionsPermitOnlyTheStableRuntime()
    {
        var options = WebView2RuntimePolicy.CreateStableEnvironmentOptions();

        Assert.Equal(CoreWebView2ReleaseChannels.Stable, options.ReleaseChannels);
        Assert.Equal(CoreWebView2ChannelSearchKind.MostStable, options.ChannelSearchKind);
    }

    [Fact]
    public void ProbeAcceptsAStableFourPartVersion()
    {
        var result = WebView2RuntimePolicy.Probe(() => "142.0.3595.94");

        Assert.True(result.IsAvailable);
        Assert.Equal(WebView2RuntimeProbeStatus.Available, result.Status);
        Assert.Equal("142.0.3595.94", result.Version);
        Assert.Null(result.Detail);
    }

    [Theory]
    [InlineData("142.0.3595.94 beta")]
    [InlineData("142.0.3595.94 dev")]
    [InlineData("142.0.3595.94 canary")]
    public void ProbeRejectsNonStableChannels(string value)
    {
        var result = WebView2RuntimePolicy.Probe(() => value);

        Assert.False(result.IsAvailable);
        Assert.Equal(WebView2RuntimeProbeStatus.UnsupportedChannel, result.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-version")]
    [InlineData("0.0.0.0")]
    public void ProbeRejectsMissingOrInvalidVersions(string? value)
    {
        var result = WebView2RuntimePolicy.Probe(() => value!);

        Assert.False(result.IsAvailable);
        Assert.Equal(WebView2RuntimeProbeStatus.InvalidVersion, result.Status);
    }

    [Fact]
    public void ProbeClassifiesAMissingRuntime()
    {
        var result = WebView2RuntimePolicy.Probe(() =>
            throw new WebView2RuntimeNotFoundException("missing"));

        Assert.False(result.IsAvailable);
        Assert.Equal(WebView2RuntimeProbeStatus.Missing, result.Status);
        Assert.Contains("missing", result.Detail, StringComparison.Ordinal);
    }

    [Fact]
    public void ProbeFailsClosedForUnexpectedLoaderErrors()
    {
        var result = WebView2RuntimePolicy.Probe(() =>
            throw new InvalidOperationException("loader failed"));

        Assert.False(result.IsAvailable);
        Assert.Equal(WebView2RuntimeProbeStatus.ProbeFailed, result.Status);
        Assert.Contains(nameof(InvalidOperationException), result.Detail, StringComparison.Ordinal);
    }
}
