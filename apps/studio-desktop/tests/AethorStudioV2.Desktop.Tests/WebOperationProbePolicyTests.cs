using System.Text.Json;

namespace AethorStudioV2.Desktop.Tests;

public sealed class WebOperationProbePolicyTests
{
    [Fact]
    public void NormalizesOnlyTheBoundedStructuredProbeShape()
    {
        var operationId = Guid.NewGuid().ToString("D");
        var probe = WebOperationProbePolicy.Prefix + JsonSerializer.Serialize(new
        {
            eventId = "frontend.serial.catalog.completed",
            operationId,
            outcome = "completed",
            durationMs = 3.14159,
            resultCount = 2
        });

        Assert.True(WebOperationProbePolicy.TryNormalizeConsoleEvent(ConsoleEvent(probe), out var normalized));
        Assert.Equal(
            WebOperationProbePolicy.Prefix
            + $"{{\"eventId\":\"frontend.serial.catalog.completed\",\"operationId\":\"{operationId}\",\"outcome\":\"completed\",\"durationMs\":3.1,\"resultCount\":2}}",
            normalized);
    }

    [Theory]
    [InlineData("ordinary console information")]
    [InlineData("AETHOR_PROBE_V1 not-json")]
    public void RejectsOrdinaryOrMalformedConsoleMessages(string message)
    {
        Assert.False(WebOperationProbePolicy.TryNormalizeConsoleEvent(ConsoleEvent(message), out var normalized));
        Assert.Null(normalized);
    }

    [Fact]
    public void RejectsExpandedOrSecretBearingProbeFields()
    {
        var probe = WebOperationProbePolicy.Prefix + JsonSerializer.Serialize(new
        {
            eventId = "frontend.serial.catalog.completed",
            operationId = Guid.NewGuid().ToString("D"),
            outcome = "completed",
            resultCount = 2,
            sessionToken = "must-not-enter-the-log"
        });

        Assert.False(WebOperationProbePolicy.TryNormalizeConsoleEvent(ConsoleEvent(probe), out _));
    }

    [Fact]
    public void RejectsInvalidTerminalSemanticsAndOversizedInput()
    {
        var failedWithoutCategory = WebOperationProbePolicy.Prefix + JsonSerializer.Serialize(new
        {
            eventId = "frontend.serial.catalog.failed",
            operationId = Guid.NewGuid().ToString("D"),
            outcome = "failed",
            durationMs = 1
        });
        Assert.False(WebOperationProbePolicy.TryNormalizeConsoleEvent(ConsoleEvent(failedWithoutCategory), out _));
        Assert.False(WebOperationProbePolicy.TryNormalizeConsoleEvent(
            new string('x', WebOperationProbePolicy.MaximumProtocolEventLength + 1),
            out _));
    }

    private static string ConsoleEvent(string message) => JsonSerializer.Serialize(new
    {
        type = "info",
        args = new[] { new { type = "string", value = message } }
    });
}
