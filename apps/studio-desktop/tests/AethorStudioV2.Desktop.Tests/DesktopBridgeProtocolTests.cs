using System.Text.Json;

namespace AethorStudioV2.Desktop.Tests;

public sealed class DesktopBridgeProtocolTests
{
    [Theory]
    [InlineData("minimize", DesktopBridgeAction.Minimize)]
    [InlineData("toggleMaximize", DesktopBridgeAction.ToggleMaximize)]
    [InlineData("close", DesktopBridgeAction.Close)]
    [InlineData("beginDrag", DesktopBridgeAction.BeginDrag)]
    [InlineData("exportDiagnostics", DesktopBridgeAction.ExportDiagnostics)]
    public void TryParseRequestAcceptsOnlyVersionedAllowlistedActions(string action, DesktopBridgeAction expected)
    {
        var json = $$"""{"contractVersion":"1.0","requestId":"request-1","action":"{{action}}"}""";

        Assert.True(DesktopBridgeProtocol.TryParseRequest(json, out var request));
        Assert.NotNull(request);
        Assert.Equal(expected, request.Action);
    }

    [Theory]
    [InlineData("")]
    [InlineData("{}")]
    [InlineData("{\"contractVersion\":\"2.0\",\"requestId\":\"request-1\",\"action\":\"close\"}")]
    [InlineData("{\"contractVersion\":\"1.0\",\"requestId\":\"request-1\",\"action\":\"openFile\"}")]
    [InlineData("{\"contractVersion\":\"1.0\",\"requestId\":\"request-1\",\"action\":0}")]
    [InlineData("{\"contractVersion\":\"1.0\",\"requestId\":\"request-1\",\"action\":\"close\",\"extra\":true}")]
    [InlineData("{\"contractVersion\":\"1.0\",\"requestId\":\"bad id\",\"action\":\"close\"}")]
    public void TryParseRequestRejectsMalformedOrExpandedMessages(string json)
    {
        Assert.False(DesktopBridgeProtocol.TryParseRequest(json, out var request));
        Assert.Null(request);
    }

    [Fact]
    public void TryParseRequestRejectsOversizedMessagesAndIdentifiers()
    {
        var longId = new string('a', 129);
        var longMessage = new string('x', DesktopBridgeProtocol.MaximumMessageLength + 1);

        Assert.False(DesktopBridgeProtocol.TryParseRequest(
            $$"""{"contractVersion":"1.0","requestId":"{{longId}}","action":"close"}""",
            out _));
        Assert.False(DesktopBridgeProtocol.TryParseRequest(longMessage, out _));
    }

    [Fact]
    public void BuildBootstrapScriptSupportsExplicitOfflineMode()
    {
        var script = DesktopBridgeProtocol.BuildBootstrapScript(null);

        Assert.Contains("\"contractVersion\":\"1.0\"", script, StringComparison.Ordinal);
        Assert.Contains("\"gateway\":null", script, StringComparison.Ordinal);
        Assert.Contains("\"exportDiagnostics\":true", script, StringComparison.Ordinal);
        Assert.Contains("Object.defineProperty", script, StringComparison.Ordinal);
        Assert.Contains("configurable: false", script, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildBootstrapScriptContainsOnlyTheCurrentLoopbackGatewaySession()
    {
        const string token = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
        var script = DesktopBridgeProtocol.BuildBootstrapScript(
            new GatewayRuntimeSession(new Uri("http://127.0.0.1:54321"), token, 42));

        Assert.Contains("http://127.0.0.1:54321", script, StringComparison.Ordinal);
        Assert.Contains(token, script, StringComparison.Ordinal);
        Assert.DoesNotContain("42", script, StringComparison.Ordinal);
    }

    [Fact]
    public void SerializeResponseUsesCamelCaseAndOmitsAbsentError()
    {
        var json = DesktopBridgeProtocol.SerializeResponse(new("1.0", "request-1", true));
        using var document = JsonDocument.Parse(json);

        Assert.Equal("1.0", document.RootElement.GetProperty("contractVersion").GetString());
        Assert.True(document.RootElement.GetProperty("ok").GetBoolean());
        Assert.False(document.RootElement.TryGetProperty("errorCode", out _));
    }
}
