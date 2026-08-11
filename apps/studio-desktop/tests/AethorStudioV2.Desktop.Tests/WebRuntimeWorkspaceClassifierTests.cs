namespace AethorStudioV2.Desktop.Tests;

public sealed class WebRuntimeWorkspaceClassifierTests
{
    [Theory]
    [InlineData("http://localhost/index.html#/console", WebRuntimeWorkspace.Console)]
    [InlineData("http://localhost/index.html#/twin", WebRuntimeWorkspace.Console)]
    [InlineData("http://localhost/index.html#/scope?signals=j1,j2", WebRuntimeWorkspace.Scope)]
    [InlineData("http://localhost/index.html#/terminal/", WebRuntimeWorkspace.Terminal)]
    [InlineData("http://localhost/#/devices", WebRuntimeWorkspace.Devices)]
    [InlineData("http://LOCALHOST/index.html#/actions", WebRuntimeWorkspace.Actions)]
    public void ClassifiesOnlyKnownPackagedWorkspaces(string source, WebRuntimeWorkspace expected) =>
        Assert.Equal(expected, WebRuntimeWorkspaceClassifier.Classify(source));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-uri")]
    [InlineData("https://localhost/index.html#/console")]
    [InlineData("http://localhost:5173/index.html#/console")]
    [InlineData("http://localhost.evil/index.html#/console")]
    [InlineData("http://user:secret@localhost/index.html#/console")]
    [InlineData("http://localhost/private.html#/console")]
    [InlineData("http://localhost/index.html#/unknown?token=must-not-leak")]
    public void RejectsUntrustedOrUnknownSources(string? source) =>
        Assert.Equal(WebRuntimeWorkspace.Unknown, WebRuntimeWorkspaceClassifier.Classify(source));
}
