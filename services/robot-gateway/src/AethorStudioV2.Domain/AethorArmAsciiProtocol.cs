using System.Globalization;
using System.Text;

namespace AethorStudioV2.Domain;

public enum AethorArmFrameKind
{
    Request,
    Acknowledgement,
    Response,
    Error,
    Done,
    Event,
    Telemetry
}

public enum AethorArmParseError
{
    None,
    Empty,
    TooLong,
    Multiline,
    NonAscii,
    BadFrame,
    BadCrc,
    UnknownOperation,
    SequenceOutOfRange
}

public sealed record AethorArmAsciiFrame(
    AethorArmFrameKind Kind,
    uint Sequence,
    string Subject,
    IReadOnlyDictionary<string, string> Fields,
    string Body,
    string Raw,
    ushort Crc16);

public readonly record struct AethorArmParseResult(
    AethorArmAsciiFrame? Frame,
    AethorArmParseError Error)
{
    public bool IsValid => Frame is not null && Error == AethorArmParseError.None;

    public string ContractCode => Error switch
    {
        AethorArmParseError.None => "VALID",
        AethorArmParseError.Empty => "EMPTY",
        AethorArmParseError.TooLong => "TOO_LONG",
        AethorArmParseError.Multiline => "MULTILINE",
        AethorArmParseError.NonAscii => "NON_ASCII",
        AethorArmParseError.BadFrame => "BAD_FRAME",
        AethorArmParseError.BadCrc => "BAD_CRC",
        AethorArmParseError.UnknownOperation => "UNKNOWN_OPERATION",
        AethorArmParseError.SequenceOutOfRange => "SEQUENCE_OUT_OF_RANGE",
        _ => throw new InvalidOperationException("Unsupported Aethor Arm parse error")
    };
}

public static class AethorArmAsciiProtocol
{
    public const string ProtocolId = "aethor-arm-ascii-v1";
    public const int MaximumLineBytes = 512;
    public const int JointCount = 7;
    public const string LineEnding = "\n";

    private static readonly HashSet<string> RequestOperations = new(StringComparer.Ordinal)
    {
        "HELLO",
        "GET_INFO",
        "GET_CONFIG",
        "GET_STATE",
        "GET_JPOS",
        "GET_MOTORS",
        "GET_DIAG",
        "HEARTBEAT",
        "SET_STREAM",
        "ALIGN_REFERENCE",
        "ENABLE",
        "STOP",
        "DISABLE",
        "CLEAR_FAULT",
        "MOVE_JOINTS"
    };

    public static ushort ComputeCrc16(string body)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (!IsPrintableAscii(body))
        {
            throw new ArgumentException("CRC body must contain printable ASCII only", nameof(body));
        }

        return ComputeCrc16(Encoding.ASCII.GetBytes(body));
    }

    public static ushort ComputeCrc16(ReadOnlySpan<byte> bytes)
    {
        ushort crc = 0xffff;
        foreach (var value in bytes)
        {
            crc ^= (ushort)(value << 8);
            for (var bit = 0; bit < 8; bit++)
            {
                crc = (ushort)((crc & 0x8000) != 0
                    ? ((crc << 1) ^ 0x1021) & 0xffff
                    : (crc << 1) & 0xffff);
            }
        }

        return crc;
    }

    public static string FormatRequest(
        uint requestId,
        string operation,
        IReadOnlyList<KeyValuePair<string, string>>? fields = null)
    {
        if (requestId == 0)
        {
            throw new ArgumentOutOfRangeException(nameof(requestId), "Aethor request ID must be non-zero");
        }
        ArgumentException.ThrowIfNullOrWhiteSpace(operation);
        if (!RequestOperations.Contains(operation))
        {
            throw new ArgumentException($"Unsupported Aethor Arm operation: {operation}", nameof(operation));
        }

        var body = new StringBuilder($"REQ {requestId.ToString(CultureInfo.InvariantCulture)} {operation}");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in fields ?? [])
        {
            if (!IsFieldKey(field.Key)
                || string.IsNullOrEmpty(field.Value)
                || !IsPrintableAscii(field.Value)
                || field.Value.Any(character => character is ' ' or '*' or '='))
            {
                throw new ArgumentException($"Invalid Aethor Arm field: {field.Key}", nameof(fields));
            }
            if (!keys.Add(field.Key))
            {
                throw new ArgumentException($"Duplicate Aethor Arm field: {field.Key}", nameof(fields));
            }
            body.Append(' ').Append(field.Key).Append('=').Append(field.Value);
        }

        var bodyText = body.ToString();
        var line = $"{bodyText} *{ComputeCrc16(bodyText).ToString("X4", CultureInfo.InvariantCulture)}";
        if (line.Length > MaximumLineBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(fields), $"Aethor Arm frame exceeds {MaximumLineBytes} ASCII bytes");
        }
        return line;
    }

    public static string EncodeRequest(
        uint requestId,
        string operation,
        IReadOnlyList<KeyValuePair<string, string>>? fields = null) =>
        FormatRequest(requestId, operation, fields) + LineEnding;

    public static AethorArmParseResult ParseFrame(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.Length == 0) return Invalid(AethorArmParseError.Empty);
        if (input.Contains('\r') || input.Contains('\n')) return Invalid(AethorArmParseError.Multiline);
        if (input.Length > MaximumLineBytes) return Invalid(AethorArmParseError.TooLong);
        if (!IsPrintableAscii(input)) return Invalid(AethorArmParseError.NonAscii);

        var crcMarker = input.Length - 6;
        if (crcMarker <= 0 || input[crcMarker] != ' ' || input[crcMarker + 1] != '*')
        {
            return Invalid(AethorArmParseError.BadFrame);
        }
        var crcText = input.AsSpan(input.Length - 4);
        if (!IsUpperHex(crcText)
            || !ushort.TryParse(crcText, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var suppliedCrc))
        {
            return Invalid(AethorArmParseError.BadFrame);
        }

        var body = input[..crcMarker];
        if (body.Contains('*')) return Invalid(AethorArmParseError.BadFrame);
        if (ComputeCrc16(body) != suppliedCrc) return Invalid(AethorArmParseError.BadCrc);

        var tokens = body.Split(' ', StringSplitOptions.None);
        if (tokens.Length < 3 || tokens.Any(string.IsNullOrEmpty)) return Invalid(AethorArmParseError.BadFrame);
        if (!TryParseKind(tokens[0], out var kind)) return Invalid(AethorArmParseError.BadFrame);
        if (tokens[1].Length is < 1 or > 10
            || !tokens[1].All(char.IsAsciiDigit)
            || !uint.TryParse(tokens[1], NumberStyles.None, CultureInfo.InvariantCulture, out var sequence)
            || (RequiresNonZeroSequence(kind) && sequence == 0))
        {
            return Invalid(AethorArmParseError.SequenceOutOfRange);
        }

        var subject = tokens[2];
        if (!IsValidSubject(kind, subject)) return Invalid(AethorArmParseError.BadFrame);
        if (kind == AethorArmFrameKind.Request && !RequestOperations.Contains(subject))
        {
            return Invalid(AethorArmParseError.UnknownOperation);
        }

        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var token in tokens.Skip(3))
        {
            var separator = token.IndexOf('=');
            if (separator <= 0
                || separator == token.Length - 1
                || token.IndexOf('=', separator + 1) >= 0)
            {
                return Invalid(AethorArmParseError.BadFrame);
            }
            var key = token[..separator];
            var value = token[(separator + 1)..];
            if (!IsFieldKey(key) || value.Any(character => character is ' ' or '*' or '='))
            {
                return Invalid(AethorArmParseError.BadFrame);
            }
            if (!fields.TryAdd(key, value)) return Invalid(AethorArmParseError.BadFrame);
        }

        return new(
            new AethorArmAsciiFrame(kind, sequence, subject, fields, body, input, suppliedCrc),
            AethorArmParseError.None);
    }

    private static AethorArmParseResult Invalid(AethorArmParseError error) => new(null, error);

    private static bool IsPrintableAscii(string value) =>
        value.All(character => character is >= ' ' and <= '~');

    private static bool IsUpperHex(ReadOnlySpan<char> value) =>
        value.Length == 4 && value.ToArray().All(character =>
            character is >= '0' and <= '9' or >= 'A' and <= 'F');

    private static bool IsFieldKey(string value) =>
        value.Length > 0
        && value[0] is >= 'a' and <= 'z'
        && value.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9' or '_');

    private static bool IsUpperToken(string value) =>
        value.Length > 0
        && value[0] is >= 'A' and <= 'Z'
        && value.All(character => character is >= 'A' and <= 'Z' or >= '0' and <= '9' or '_');

    private static bool IsValidSubject(AethorArmFrameKind kind, string subject) => kind switch
    {
        AethorArmFrameKind.Acknowledgement => subject == "accepted",
        AethorArmFrameKind.Response => subject == "ok",
        _ => IsUpperToken(subject)
    };

    private static bool RequiresNonZeroSequence(AethorArmFrameKind kind) => kind is
        AethorArmFrameKind.Request
        or AethorArmFrameKind.Acknowledgement
        or AethorArmFrameKind.Response
        or AethorArmFrameKind.Done;

    private static bool TryParseKind(string token, out AethorArmFrameKind kind)
    {
        kind = token switch
        {
            "REQ" => AethorArmFrameKind.Request,
            "ACK" => AethorArmFrameKind.Acknowledgement,
            "RSP" => AethorArmFrameKind.Response,
            "ERR" => AethorArmFrameKind.Error,
            "DONE" => AethorArmFrameKind.Done,
            "EVT" => AethorArmFrameKind.Event,
            "TEL" => AethorArmFrameKind.Telemetry,
            _ => default
        };
        return token is "REQ" or "ACK" or "RSP" or "ERR" or "DONE" or "EVT" or "TEL";
    }
}

public enum AethorArmDecodedRecordKind
{
    Line,
    Discarded
}

public sealed record AethorArmDecodedRecord(
    AethorArmDecodedRecordKind Kind,
    string Value,
    string? Reason = null);

public sealed class AethorArmAsciiLineDecoder
{
    private readonly StringBuilder buffer = new(AethorArmAsciiProtocol.MaximumLineBytes);
    private bool pendingCarriageReturn;
    private string? discardReason;

    public IReadOnlyList<AethorArmDecodedRecord> Append(ReadOnlySpan<byte> chunk)
    {
        var records = new List<AethorArmDecodedRecord>();
        foreach (var value in chunk)
        {
            if (value == (byte)'\n')
            {
                FinishRecord(records);
                continue;
            }
            if (discardReason is not null) continue;
            if (pendingCarriageReturn)
            {
                discardReason = "control-character";
                continue;
            }
            if (value == (byte)'\r')
            {
                pendingCarriageReturn = true;
                continue;
            }
            if (value is < 0x20 or > 0x7e)
            {
                discardReason = value > 0x7f ? "non-ascii" : "control-character";
                continue;
            }
            if (buffer.Length < AethorArmAsciiProtocol.MaximumLineBytes)
            {
                buffer.Append((char)value);
            }
            else
            {
                discardReason = "overlong";
            }
        }
        return records;
    }

    public AethorArmDecodedRecord? Finish()
    {
        if (buffer.Length == 0 && !pendingCarriageReturn && discardReason is null) return null;
        var record = new AethorArmDecodedRecord(
            AethorArmDecodedRecordKind.Discarded,
            buffer.ToString(),
            discardReason ?? "incomplete");
        Reset();
        return record;
    }

    public void Reset()
    {
        buffer.Clear();
        pendingCarriageReturn = false;
        discardReason = null;
    }

    private void FinishRecord(List<AethorArmDecodedRecord> records)
    {
        if (discardReason is not null)
        {
            records.Add(new(AethorArmDecodedRecordKind.Discarded, buffer.ToString(), discardReason));
        }
        else if (buffer.Length > 0)
        {
            records.Add(new(AethorArmDecodedRecordKind.Line, buffer.ToString()));
        }
        Reset();
    }
}
