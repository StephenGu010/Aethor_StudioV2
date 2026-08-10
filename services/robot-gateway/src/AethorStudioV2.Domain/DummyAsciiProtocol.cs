using System.Globalization;
using System.Text;

namespace AethorStudioV2.Domain;

public enum DummyReadQuery
{
    JointPositions,
    Mode,
    Enable
}

public enum DummySystemCommand
{
    Enable,
    Stop,
    Disable,
    Home,
    Reset
}

public enum DummyResponseKind
{
    SystemAck,
    GenericAck,
    JointPositions,
    Mode,
    UnsupportedMode,
    Enable,
    ModeAck,
    Queue,
    Error,
    Malformed,
    Unknown
}

public enum DummyDirectCommandKind
{
    QueryJointPositions,
    QueryMode,
    QueryEnable,
    Enable,
    Stop,
    Disable,
    SetMode,
    JointGroup
}

public sealed record DummyDirectCommand(
    DummyDirectCommandKind Kind,
    string NormalizedLine,
    int? Mode = null,
    IReadOnlyList<double>? PositionsDeg = null,
    double? SpeedDegS = null);

public sealed record DummyResponse(
    DummyResponseKind Kind,
    string Raw,
    IReadOnlyList<double>? PositionsDeg = null,
    int? Mode = null,
    string? ModeName = null,
    bool? Enabled = null,
    int? QueueFreeSlots = null,
    bool? QueueAccepted = null,
    string? ErrorCode = null,
    string? Detail = null)
{
    public string ContractKind => Kind switch
    {
        DummyResponseKind.SystemAck => "systemAck",
        DummyResponseKind.GenericAck => "genericAck",
        DummyResponseKind.JointPositions => "jointPositions",
        DummyResponseKind.Mode => "mode",
        DummyResponseKind.UnsupportedMode => "unsupportedMode",
        DummyResponseKind.Enable => "enable",
        DummyResponseKind.ModeAck => "modeAck",
        DummyResponseKind.Queue => "queue",
        DummyResponseKind.Error => "error",
        DummyResponseKind.Malformed => "malformed",
        _ => "unknown"
    };
}

public static class DummyAsciiProtocol
{
    public const int BaudRate = 115_200;
    public const int MaximumLineCharacters = 255;
    public const int JointCount = 6;
    public const string LineEnding = "\n";

    private static readonly Dictionary<int, string> AllowedModeNames =
        new Dictionary<int, string>
        {
            [1] = "SEQ_POINT",
            [2] = "INT_POINT",
            [3] = "CONT_TRAJ"
        };

    public static string FormatQuery(DummyReadQuery query) => query switch
    {
        DummyReadQuery.JointPositions => "#GETJPOS",
        DummyReadQuery.Mode => "#GETMODE",
        DummyReadQuery.Enable => "#GETENABLE",
        _ => throw new ArgumentOutOfRangeException(nameof(query), query, "Unsupported read-only query")
    };

    public static string EncodeQuery(DummyReadQuery query) => FormatQuery(query) + LineEnding;

    public static string FormatSystemCommand(DummySystemCommand command) => command switch
    {
        DummySystemCommand.Enable => "!START",
        DummySystemCommand.Stop => "!STOP",
        DummySystemCommand.Disable => "!DISABLE",
        DummySystemCommand.Home => "!HOME",
        DummySystemCommand.Reset => "!RESET",
        _ => throw new ArgumentOutOfRangeException(nameof(command), command, "Unsupported system command")
    };

    public static string FormatSetMode(int mode)
    {
        if (!AllowedModeNames.ContainsKey(mode))
        {
            throw new ArgumentOutOfRangeException(nameof(mode), "Dummy ASCII v1 supports modes 1-3 only");
        }

        return $"#CMDMODE {mode.ToString(CultureInfo.InvariantCulture)}";
    }

    public static string FormatJointGroup(IReadOnlyList<double> positionsDeg, double speedDegS)
    {
        ArgumentNullException.ThrowIfNull(positionsDeg);
        if (positionsDeg.Count != JointCount || positionsDeg.Any(value => !double.IsFinite(value)))
        {
            throw new ArgumentException("Exactly six finite joint positions are required", nameof(positionsDeg));
        }

        if (!double.IsFinite(speedDegS) || speedDegS <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(speedDegS), "Speed must be finite and greater than zero");
        }

        var values = positionsDeg
            .Append(speedDegS)
            .Select(value => value.ToString("0.###############", CultureInfo.InvariantCulture));
        return $">{string.Join(',', values)}";
    }

    public const string SafetyZeroCurrentLine = "$0,0,0,0,0,0";

    public static bool TryParseEngineeringCommand(
        string? input,
        double maximumJointSpeedDegS,
        out DummyDirectCommand? command,
        out string error)
    {
        command = null;
        error = string.Empty;
        if (string.IsNullOrWhiteSpace(input))
        {
            error = "命令不能为空";
            return false;
        }

        if (!double.IsFinite(maximumJointSpeedDegS)
            || maximumJointSpeedDegS <= 0
            || maximumJointSpeedDegS > 100)
        {
            error = "网关的 engineering 速度上限配置无效";
            return false;
        }

        if (input.Contains('\r') || input.Contains('\n'))
        {
            error = "一次请求只能包含一行命令";
            return false;
        }

        var line = input.Trim();
        if (line.Length is < 1 or > MaximumLineCharacters || line.Any(character => !char.IsAscii(character) || char.IsControl(character)))
        {
            error = "命令必须是 1-255 个可打印 ASCII 字符";
            return false;
        }

        command = line switch
        {
            "#GETJPOS" => new(DummyDirectCommandKind.QueryJointPositions, line),
            "#GETMODE" => new(DummyDirectCommandKind.QueryMode, line),
            "#GETENABLE" => new(DummyDirectCommandKind.QueryEnable, line),
            "!START" => new(DummyDirectCommandKind.Enable, line),
            "!STOP" => new(DummyDirectCommandKind.Stop, line),
            "!DISABLE" => new(DummyDirectCommandKind.Disable, line),
            "#CMDMODE 1" => new(DummyDirectCommandKind.SetMode, line, Mode: 1),
            "#CMDMODE 2" => new(DummyDirectCommandKind.SetMode, line, Mode: 2),
            "#CMDMODE 3" => new(DummyDirectCommandKind.SetMode, line, Mode: 3),
            _ => null
        };
        if (command is not null)
        {
            return true;
        }

        if (!line.StartsWith('>'))
        {
            error = "engineering 模式只允许查询、启停/去使能、模式 1-3 和六轴整组目标；HOME/RESET/RGB/电流命令均被拒绝";
            return false;
        }

        var tokens = line[1..].Split(',', StringSplitOptions.None);
        if (tokens.Length != JointCount + 1)
        {
            error = "六轴整组命令必须包含 6 个角度和 1 个显式速度";
            return false;
        }

        var values = new double[tokens.Length];
        for (var index = 0; index < tokens.Length; index++)
        {
            if (!double.TryParse(tokens[index], NumberStyles.Float, CultureInfo.InvariantCulture, out values[index])
                || !double.IsFinite(values[index]))
            {
                error = "六轴整组命令包含非法数值";
                return false;
            }
        }

        for (var index = 0; index < JointCount; index++)
        {
            var limit = DummyJointLimits.All[index];
            if (values[index] < limit.LowerDeg || values[index] > limit.UpperDeg)
            {
                error = $"J{index + 1} 目标超出配置限位";
                return false;
            }
        }

        var speed = values[^1];
        if (speed <= 0 || speed > maximumJointSpeedDegS)
        {
            error = $"速度必须在 0-{maximumJointSpeedDegS.ToString("0.###", CultureInfo.InvariantCulture)} deg/s 的固件输入范围内";
            return false;
        }

        var positions = values.Take(JointCount).ToArray();
        command = new(
            DummyDirectCommandKind.JointGroup,
            FormatJointGroup(positions, speed),
            PositionsDeg: positions,
            SpeedDegS: speed);
        return true;
    }

    public static DummyResponse ParseResponseLine(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var raw = input.Trim();
        if (raw.Length == 0)
        {
            return new(DummyResponseKind.Unknown, raw);
        }

        if (raw is "Started ok" or "Stopped ok" or "Disabled ok" or "Homing ok")
        {
            return new(DummyResponseKind.SystemAck, raw);
        }

        if (raw == "ok")
        {
            return new(DummyResponseKind.GenericAck, raw);
        }

        if (raw.StartsWith("error", StringComparison.Ordinal))
        {
            var detail = raw["error".Length..].Trim();
            var code = detail.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "UNKNOWN";
            return new(DummyResponseKind.Error, raw, ErrorCode: code, Detail: detail);
        }

        if (raw.All(char.IsAsciiDigit))
        {
            var freeSlots = int.Parse(raw, NumberStyles.None, CultureInfo.InvariantCulture);
            if (freeSlots == 255)
            {
                return new(DummyResponseKind.Queue, raw, QueueFreeSlots: freeSlots, QueueAccepted: false);
            }

            if (freeSlots is >= 0 and <= 15)
            {
                return new(DummyResponseKind.Queue, raw, QueueFreeSlots: freeSlots, QueueAccepted: true);
            }

            return Malformed(raw, "invalid-queue-value");
        }

        const string modeAckPrefix = "ok Set command mode to [";
        if (raw.StartsWith(modeAckPrefix, StringComparison.Ordinal))
        {
            return ParseModeAcknowledgement(raw);
        }

        var tokens = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length == 2 && tokens[0] == "ok" && tokens[1] is "0" or "1")
        {
            return new(DummyResponseKind.Enable, raw, Enabled: tokens[1] == "1");
        }

        if (tokens.Length == 3 && tokens[0] == "ok" && TryParseInteger(tokens[1], out var mode))
        {
            return ParseMode(raw, mode, tokens[2], DummyResponseKind.Mode);
        }

        if (tokens.Length == JointCount + 1 && tokens[0] == "ok")
        {
            var positions = new double[JointCount];
            for (var index = 0; index < JointCount; index++)
            {
                if (!double.TryParse(tokens[index + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
                    || !double.IsFinite(value))
                {
                    return Malformed(raw, "invalid-number");
                }

                positions[index] = value;
            }

            return new(DummyResponseKind.JointPositions, raw, PositionsDeg: positions);
        }

        return new(DummyResponseKind.Unknown, raw);
    }

    public static bool IsExpectedResponse(DummyReadQuery query, DummyResponse response) => query switch
    {
        DummyReadQuery.JointPositions => response.Kind == DummyResponseKind.JointPositions,
        DummyReadQuery.Mode => response.Kind is DummyResponseKind.Mode or DummyResponseKind.UnsupportedMode,
        DummyReadQuery.Enable => response.Kind == DummyResponseKind.Enable,
        _ => false
    };

    private static DummyResponse ParseModeAcknowledgement(string raw)
    {
        const string prefix = "ok Set command mode to [";
        var closingBracket = raw.IndexOf(']', prefix.Length);
        if (closingBracket < 0 || !TryParseInteger(raw[prefix.Length..closingBracket], out var mode))
        {
            return Malformed(raw, "invalid-number");
        }

        var expectedSuffixStart = closingBracket + 1;
        if (expectedSuffixStart >= raw.Length || !raw.AsSpan(expectedSuffixStart).StartsWith(" ("))
        {
            return new(DummyResponseKind.Unknown, raw);
        }

        var nameStart = expectedSuffixStart + 2;
        if (!raw.EndsWith(')') || nameStart >= raw.Length - 1)
        {
            return new(DummyResponseKind.Unknown, raw);
        }

        var name = raw[nameStart..^1];
        return ParseMode(raw, mode, name, DummyResponseKind.ModeAck);
    }

    private static DummyResponse ParseMode(string raw, int mode, string name, DummyResponseKind successKind)
    {
        if (!AllowedModeNames.TryGetValue(mode, out var expectedName))
        {
            return new(DummyResponseKind.UnsupportedMode, raw, Mode: mode, ModeName: name);
        }

        if (!string.Equals(expectedName, name, StringComparison.Ordinal))
        {
            return Malformed(raw, "invalid-mode-name");
        }

        return new(successKind, raw, Mode: mode, ModeName: expectedName);
    }

    private static DummyResponse Malformed(string raw, string reason) =>
        new(DummyResponseKind.Malformed, raw, Detail: reason);

    private static bool TryParseInteger(string input, out int value) =>
        int.TryParse(input, NumberStyles.None, CultureInfo.InvariantCulture, out value);
}

public enum DummyDecodedRecordKind
{
    Line,
    Discarded
}

public sealed record DummyDecodedRecord(DummyDecodedRecordKind Kind, string Value, string? Reason = null);

public sealed class DummyAsciiLineDecoder
{
    private readonly StringBuilder buffer = new(DummyAsciiProtocol.MaximumLineCharacters);
    private string? discardReason;

    public IReadOnlyList<DummyDecodedRecord> Append(ReadOnlySpan<byte> chunk)
    {
        var records = new List<DummyDecodedRecord>();
        foreach (var value in chunk)
        {
            if (value is (byte)'\r' or (byte)'\n')
            {
                FinishRecord(records);
                continue;
            }

            if (discardReason is not null)
            {
                continue;
            }

            if (value > 0x7f)
            {
                discardReason = "non-ascii";
                continue;
            }

            buffer.Append((char)value);
            if (buffer.Length > DummyAsciiProtocol.MaximumLineCharacters)
            {
                discardReason = "overlong";
            }
        }

        return records;
    }

    public DummyDecodedRecord? Finish()
    {
        if (buffer.Length == 0 && discardReason is null)
        {
            return null;
        }

        var record = new DummyDecodedRecord(
            DummyDecodedRecordKind.Discarded,
            buffer.ToString(),
            discardReason ?? "incomplete");
        Reset();
        return record;
    }

    public void Reset()
    {
        buffer.Clear();
        discardReason = null;
    }

    private void FinishRecord(List<DummyDecodedRecord> records)
    {
        if (discardReason is not null)
        {
            records.Add(new(DummyDecodedRecordKind.Discarded, buffer.ToString(), discardReason));
        }
        else if (buffer.Length > 0)
        {
            records.Add(new(DummyDecodedRecordKind.Line, buffer.ToString()));
        }

        Reset();
    }
}
