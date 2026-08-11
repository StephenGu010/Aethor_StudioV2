using System.Text.Json;
using System.Text.Json.Serialization;

namespace AethorStudioV2.Desktop;

public enum DesktopBridgeAction
{
    Minimize,
    ToggleMaximize,
    Close,
    BeginDrag,
    ExportDiagnostics
}

public enum DesktopBridgeErrorCode
{
    Unsupported,
    InvalidRequest,
    HostFailure
}

public sealed record DesktopBridgeRequestV1(
    string ContractVersion,
    string RequestId,
    DesktopBridgeAction Action);

public sealed record DesktopBridgeResponseV1(
    string ContractVersion,
    string RequestId,
    bool Ok,
    DesktopBridgeErrorCode? ErrorCode = null);

public sealed record DesktopGatewayBootstrapV1(string BaseUrl, string SessionToken);

public sealed record DesktopBridgeCapabilitiesV1(
    bool Available,
    bool Minimize,
    bool ToggleMaximize,
    bool Close,
    bool ExportDiagnostics);

public sealed record DesktopBootstrapV1(
    string ContractVersion,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DesktopGatewayBootstrapV1? Gateway,
    DesktopBridgeCapabilitiesV1 Capabilities);

public static class DesktopBridgeProtocol
{
    public const string ContractVersion = "1.0";
    public const int MaximumMessageLength = 4096;
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static bool TryParseRequest(string json, out DesktopBridgeRequestV1? request)
    {
        request = null;
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumMessageLength) return false;
        try
        {
            var candidate = JsonSerializer.Deserialize<DesktopBridgeRequestV1>(json, JsonOptions);
            if (candidate is null
                || candidate.ContractVersion != ContractVersion
                || string.IsNullOrWhiteSpace(candidate.RequestId)
                || candidate.RequestId.Length > 128
                || candidate.RequestId.Any(character => character is < (char)0x21 or > (char)0x7e))
            {
                return false;
            }
            request = candidate;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static string SerializeResponse(DesktopBridgeResponseV1 response) =>
        JsonSerializer.Serialize(response, JsonOptions);

    public static string BuildBootstrapScript(GatewayRuntimeSession? gateway)
    {
        var bootstrap = new DesktopBootstrapV1(
            ContractVersion,
            gateway is null ? null : new(gateway.BaseUri.GetLeftPart(UriPartial.Authority), gateway.SessionToken),
            new(true, true, true, true, true));
        var json = JsonSerializer.Serialize(bootstrap, JsonOptions);
        return "(() => { const value = " + json
            + "; if (value.gateway) Object.freeze(value.gateway); Object.freeze(value.capabilities); Object.freeze(value);"
            + " Object.defineProperty(globalThis, '__AETHOR_DESKTOP_BOOTSTRAP__', { value, configurable: false, writable: false }); })();";
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false));
        return options;
    }
}
