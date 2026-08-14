using System.Text.Json;
using System.Text.Json.Serialization;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class GatewayContractSerializationTests
{
    private static readonly JsonSerializerOptions WireOptions = CreateWireOptions();

    [Fact]
    public void ProtocolFrameOmitsAnUnavailableOptionalCorrelationId()
    {
        var frame = new ProtocolFrame(
            "frame-1",
            new DateTimeOffset(2026, 8, 14, 0, 0, 0, TimeSpan.Zero),
            ProtocolDirection.Error,
            "Read-only query timed out: #GETJPOS",
            "queryTimeout",
            DataSource.Unavailable);

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(frame, WireOptions));
        var root = document.RootElement;

        Assert.False(root.TryGetProperty("correlationId", out _));
        Assert.Equal("error", root.GetProperty("direction").GetString());
        Assert.Equal("queryTimeout", root.GetProperty("parsedKind").GetString());
    }

    [Fact]
    public void ProtocolFrameKeepsAnObservedCorrelationId()
    {
        var frame = new ProtocolFrame(
            "frame-2",
            new DateTimeOffset(2026, 8, 14, 0, 0, 0, TimeSpan.Zero),
            ProtocolDirection.Tx,
            "#GETJPOS",
            "query",
            DataSource.Commanded,
            "correlation-2");

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(frame, WireOptions));

        Assert.Equal("correlation-2", document.RootElement.GetProperty("correlationId").GetString());
    }

    private static JsonSerializerOptions CreateWireOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DictionaryKeyPolicy = JsonNamingPolicy.CamelCase
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
