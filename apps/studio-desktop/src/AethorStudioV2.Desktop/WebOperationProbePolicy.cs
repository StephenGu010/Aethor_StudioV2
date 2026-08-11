using System.Text.Json;

namespace AethorStudioV2.Desktop;

public static class WebOperationProbePolicy
{
    public const string Prefix = "AETHOR_PROBE_V1 ";
    public const int MaximumProtocolEventLength = 8192;
    public const int MaximumProbeLength = 1024;
    private static readonly HashSet<string> AllowedProbeFields = new(StringComparer.Ordinal)
    {
        "eventId",
        "operationId",
        "outcome",
        "durationMs",
        "resultCount",
        "failureCategory"
    };

    public static bool TryNormalizeConsoleEvent(string protocolEventJson, out string? normalizedProbe)
    {
        normalizedProbe = null;
        if (string.IsNullOrWhiteSpace(protocolEventJson)
            || protocolEventJson.Length > MaximumProtocolEventLength)
        {
            return false;
        }

        try
        {
            using var eventDocument = JsonDocument.Parse(protocolEventJson, new JsonDocumentOptions
            {
                MaxDepth = 8,
                CommentHandling = JsonCommentHandling.Disallow,
                AllowTrailingCommas = false
            });
            var root = eventDocument.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("type", out var type)
                || type.GetString() != "info"
                || !root.TryGetProperty("args", out var arguments)
                || arguments.ValueKind != JsonValueKind.Array
                || arguments.GetArrayLength() < 1)
            {
                return false;
            }

            var firstArgument = arguments[0];
            if (firstArgument.ValueKind != JsonValueKind.Object
                || !firstArgument.TryGetProperty("type", out var argumentType)
                || argumentType.GetString() != "string"
                || !firstArgument.TryGetProperty("value", out var valueElement)
                || valueElement.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            var value = valueElement.GetString();
            if (value is null
                || value.Length > MaximumProbeLength
                || !value.StartsWith(Prefix, StringComparison.Ordinal))
            {
                return false;
            }

            using var probeDocument = JsonDocument.Parse(value[Prefix.Length..], new JsonDocumentOptions
            {
                MaxDepth = 4,
                CommentHandling = JsonCommentHandling.Disallow,
                AllowTrailingCommas = false
            });
            return TryNormalizeProbe(probeDocument.RootElement, out normalizedProbe);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool TryNormalizeProbe(JsonElement probe, out string? normalizedProbe)
    {
        normalizedProbe = null;
        if (probe.ValueKind != JsonValueKind.Object
            || probe.EnumerateObject().Any(property => !AllowedProbeFields.Contains(property.Name))
            || !TryGetBoundedIdentifier(probe, "eventId", 96, out var eventId)
            || !eventId.StartsWith("frontend.", StringComparison.Ordinal)
            || !TryGetBoundedIdentifier(probe, "operationId", 64, out var operationId)
            || !Guid.TryParseExact(operationId, "D", out var operationGuid)
            || !TryGetBoundedIdentifier(probe, "outcome", 16, out var outcome)
            || outcome is not ("started" or "completed" or "failed")
            || !TryGetOptionalNumber(probe, "durationMs", 0, 600_000, out var durationMs)
            || !TryGetOptionalInteger(probe, "resultCount", 0, 4096, out var resultCount)
            || !TryGetOptionalIdentifier(probe, "failureCategory", 48, out var failureCategory)
            || (outcome == "failed") != (failureCategory is not null)
            || (outcome == "started" && (durationMs is not null || resultCount is not null)))
        {
            return false;
        }

        var fields = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["eventId"] = eventId,
            ["operationId"] = operationGuid.ToString("D"),
            ["outcome"] = outcome
        };
        if (durationMs is not null) fields["durationMs"] = Math.Round(durationMs.Value, 1);
        if (resultCount is not null) fields["resultCount"] = resultCount.Value;
        if (failureCategory is not null) fields["failureCategory"] = failureCategory;
        normalizedProbe = Prefix + JsonSerializer.Serialize(fields);
        return true;
    }

    private static bool TryGetBoundedIdentifier(
        JsonElement root,
        string propertyName,
        int maximumLength,
        out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(propertyName, out var element)
            || element.ValueKind != JsonValueKind.String)
        {
            return false;
        }
        value = element.GetString() ?? string.Empty;
        return IsBoundedIdentifier(value, maximumLength);
    }

    private static bool TryGetOptionalIdentifier(
        JsonElement root,
        string propertyName,
        int maximumLength,
        out string? value)
    {
        value = null;
        if (!root.TryGetProperty(propertyName, out var element)) return true;
        if (element.ValueKind != JsonValueKind.String) return false;
        value = element.GetString();
        return value is not null && IsBoundedIdentifier(value, maximumLength);
    }

    private static bool TryGetOptionalNumber(
        JsonElement root,
        string propertyName,
        double minimum,
        double maximum,
        out double? value)
    {
        value = null;
        if (!root.TryGetProperty(propertyName, out var element)) return true;
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetDouble(out var parsed)) return false;
        if (!double.IsFinite(parsed) || parsed < minimum || parsed > maximum) return false;
        value = parsed;
        return true;
    }

    private static bool TryGetOptionalInteger(
        JsonElement root,
        string propertyName,
        int minimum,
        int maximum,
        out int? value)
    {
        value = null;
        if (!root.TryGetProperty(propertyName, out var element)) return true;
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var parsed)) return false;
        if (parsed < minimum || parsed > maximum) return false;
        value = parsed;
        return true;
    }

    private static bool IsBoundedIdentifier(string value, int maximumLength) =>
        value.Length is > 0 && value.Length <= maximumLength
        && value.All(character => character is >= 'a' and <= 'z'
            or >= 'A' and <= 'Z'
            or >= '0' and <= '9'
            or '.' or '_' or '-');
}
