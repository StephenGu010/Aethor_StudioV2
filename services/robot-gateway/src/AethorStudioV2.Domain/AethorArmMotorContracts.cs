using System.Globalization;

namespace AethorStudioV2.Domain;

public static class AethorArmGatewayContractV1
{
    public const string ContractVersion = "1.0";
    public const string ProfileId = "aethor-robo-dual-7dof";
    public const string LeftArmGroupId = "left-arm";
    public const string RightArmGroupId = "right-arm";
}

public sealed record AethorArmSessionIdentity(
    string ControllerId,
    string ArmId,
    string BootId,
    string DeviceSession,
    string FirmwareVersion,
    IReadOnlyList<string> SupportedModes,
    int StreamMaximumHz);

public sealed record AethorArmMotorSampleV1(
    int MotorId,
    double PositionDeg,
    double FeedbackAgeMs,
    bool Valid,
    bool IdentityConflict = false);

public sealed record AethorArmMotorFrameV1(
    string ContractVersion,
    string ProfileId,
    string JointGroupId,
    string ControllerId,
    string ArmId,
    string BootId,
    uint FrameSeq,
    DateTimeOffset ReceivedAtUtc,
    bool SnapshotComplete,
    IReadOnlyList<AethorArmMotorSampleV1> Motors,
    IReadOnlyList<int> UnexpectedMotorIds);

public readonly record struct AethorArmProjectionResult(
    AethorArmMotorFrameV1? Frame,
    string? Error)
{
    public bool IsValid => Frame is not null && Error is null;
}

/// <summary>
/// Converts one firmware joint snapshot into the gateway trust-boundary shape.
/// The seven q_deg slots are interpreted only through the discovery masks;
/// placeholder values for missing IDs are never emitted as motor samples.
/// </summary>
public static class AethorArmMotorFrameProjector
{
    private const byte AllJointBits = 0x7f;

    public static AethorArmProjectionResult ProjectJointSnapshot(
        AethorArmAsciiFrame source,
        string sourceOperation,
        AethorArmSessionIdentity identity,
        string jointGroupId,
        uint gatewayFrameSequence,
        DateTimeOffset receivedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceOperation);
        ArgumentNullException.ThrowIfNull(identity);

        if (jointGroupId is not AethorArmGatewayContractV1.LeftArmGroupId
            and not AethorArmGatewayContractV1.RightArmGroupId)
        {
            return Invalid("joint_group_invalid");
        }

        var supported = source.Kind == AethorArmFrameKind.Telemetry
            ? source.Subject == "JOINT_STATE"
            : source.Kind == AethorArmFrameKind.Response && sourceOperation == "GET_JPOS";
        if (!supported)
        {
            return Invalid("frame_kind_not_joint_snapshot");
        }

        if (!TryParseUnsigned(source.Fields, "t_us", out _))
        {
            return Invalid("t_us_invalid");
        }
        if (!TryParseSevenDecimals(source.Fields, "q_deg", out var positionsDeg))
        {
            return Invalid("q_deg_invalid");
        }
        if (!TryParseMask(source.Fields, "present_mask", out var presentMask)
            || !TryParseMask(source.Fields, "valid_mask", out var validMask)
            || !TryParseMask(source.Fields, "conflict_mask", out var conflictMask))
        {
            return Invalid("discovery_mask_invalid");
        }
        if ((validMask & ~presentMask) != 0
            || (validMask & conflictMask) != 0)
        {
            return Invalid("discovery_mask_inconsistent");
        }
        if (!TryParseUnexpectedIds(source.Fields, out var unexpectedMotorIds))
        {
            return Invalid("unexpected_ids_invalid");
        }

        double[]? feedbackAges = null;
        if (source.Fields.ContainsKey("age_ms"))
        {
            if (!TryParseSevenUnsignedDecimals(source.Fields, "age_ms", out var parsedAges))
            {
                return Invalid("age_ms_invalid");
            }
            feedbackAges = parsedAges;
        }
        var motors = new List<AethorArmMotorSampleV1>(AethorArmAsciiProtocol.JointCount);
        for (var index = 0; index < AethorArmAsciiProtocol.JointCount; index++)
        {
            var bit = 1 << index;
            if ((presentMask & bit) == 0 && (conflictMask & bit) == 0)
            {
                continue;
            }

            var conflict = (conflictMask & bit) != 0;
            var valid = (validMask & bit) != 0 && !conflict;
            var feedbackAgeMs = feedbackAges?[index] ?? (valid ? 0d : 65_535d);
            motors.Add(new(
                MotorId: index + 1,
                PositionDeg: positionsDeg[index],
                FeedbackAgeMs: feedbackAgeMs,
                Valid: valid,
                IdentityConflict: conflict));
        }

        return new(new(
            AethorArmGatewayContractV1.ContractVersion,
            AethorArmGatewayContractV1.ProfileId,
            jointGroupId,
            identity.ControllerId,
            identity.ArmId,
            identity.BootId,
            gatewayFrameSequence,
            receivedAtUtc,
            SnapshotComplete: true,
            motors,
            unexpectedMotorIds), null);
    }

    private static AethorArmProjectionResult Invalid(string error) => new(null, error);

    private static bool TryParseUnsigned(
        IReadOnlyDictionary<string, string> fields,
        string key,
        out ulong value)
    {
        value = default;
        return fields.TryGetValue(key, out var text)
            && text.Length is > 0 and <= 20
            && text.All(char.IsAsciiDigit)
            && ulong.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
    }

    private static bool TryParseSevenDecimals(
        IReadOnlyDictionary<string, string> fields,
        string key,
        out double[] values)
    {
        values = [];
        if (!fields.TryGetValue(key, out var text))
        {
            return false;
        }

        var tokens = text.Split(',', StringSplitOptions.None);
        if (tokens.Length != AethorArmAsciiProtocol.JointCount)
        {
            return false;
        }

        values = new double[AethorArmAsciiProtocol.JointCount];
        for (var index = 0; index < tokens.Length; index++)
        {
            if (!TryParseDecimal(tokens[index], out values[index]))
            {
                values = [];
                return false;
            }
        }
        return true;
    }

    private static bool TryParseSevenUnsignedDecimals(
        IReadOnlyDictionary<string, string> fields,
        string key,
        out double[] values)
    {
        values = [];
        if (!fields.TryGetValue(key, out var text))
        {
            return false;
        }

        var tokens = text.Split(',', StringSplitOptions.None);
        if (tokens.Length != AethorArmAsciiProtocol.JointCount)
        {
            return false;
        }

        values = new double[AethorArmAsciiProtocol.JointCount];
        for (var index = 0; index < tokens.Length; index++)
        {
            if (!TryParseDecimal(tokens[index], out values[index]) || values[index] is < 0 or > 65_535)
            {
                values = [];
                return false;
            }
        }
        return true;
    }

    private static bool TryParseDecimal(string token, out double value)
    {
        value = default;
        if (string.IsNullOrEmpty(token)
            || token.Contains('e', StringComparison.OrdinalIgnoreCase)
            || token.Count(character => character == '.') > 1)
        {
            return false;
        }

        var digitsStart = token[0] is '-' or '+' ? 1 : 0;
        if (digitsStart == token.Length
            || !token[digitsStart..].Any(char.IsAsciiDigit)
            || token[digitsStart..].Any(character => character != '.' && !char.IsAsciiDigit(character)))
        {
            return false;
        }

        return double.TryParse(
            token,
            NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
            CultureInfo.InvariantCulture,
            out value)
            && double.IsFinite(value);
    }

    private static bool TryParseMask(
        IReadOnlyDictionary<string, string> fields,
        string key,
        out byte value)
    {
        value = default;
        if (!fields.TryGetValue(key, out var text)
            || text.Length is < 3 or > 4
            || !text.StartsWith("0x", StringComparison.Ordinal)
            || !text[2..].All(character => character is >= '0' and <= '9' or >= 'A' and <= 'F')
            || !byte.TryParse(text[2..], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out value))
        {
            return false;
        }
        return (value & ~AllJointBits) == 0;
    }

    private static bool TryParseUnexpectedIds(
        IReadOnlyDictionary<string, string> fields,
        out IReadOnlyList<int> unexpectedMotorIds)
    {
        unexpectedMotorIds = [];
        if (!fields.TryGetValue("unexpected_ids", out var text))
        {
            return false;
        }
        if (text == "none")
        {
            return true;
        }

        var tokens = text.Split(',', StringSplitOptions.None);
        if (tokens.Length is < 1 or > 32)
        {
            return false;
        }

        var result = new List<int>(tokens.Length);
        var previous = -1;
        foreach (var token in tokens)
        {
            if (!int.TryParse(token, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
                || value is < 0 or > 255
                || value is >= 1 and <= AethorArmAsciiProtocol.JointCount
                || value <= previous)
            {
                return false;
            }
            result.Add(value);
            previous = value;
        }
        unexpectedMotorIds = result;
        return true;
    }
}
