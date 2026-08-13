using System.Globalization;
using System.Text;
using System.Text.Json;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class AethorArmAsciiConformanceTests
{
    [Fact]
    public void CrcImplementationMatchesTheIndependentCcittFalseCheckValue()
    {
        Assert.Equal(0x29b1, AethorArmAsciiProtocol.ComputeCrc16("123456789"));
    }

    [Fact]
    public void CSharpCodecConsumesEveryLanguageNeutralCrcAndRequestVector()
    {
        using var document = LoadVectors();
        foreach (var testCase in document.RootElement.GetProperty("crcCases").EnumerateArray())
        {
            var body = testCase.GetProperty("body").GetString()!;
            var expected = testCase.GetProperty("expectedCrc").GetString();
            Assert.Equal(expected, AethorArmAsciiProtocol.ComputeCrc16(body).ToString("X4", CultureInfo.InvariantCulture));
        }

        foreach (var testCase in document.RootElement.GetProperty("requestCases").EnumerateArray())
        {
            var fields = testCase.GetProperty("fields").EnumerateArray()
                .Select(pair => new KeyValuePair<string, string>(
                    pair[0].GetString()!,
                    pair[1].GetString()!))
                .ToArray();
            Assert.Equal(
                testCase.GetProperty("expectedLine").GetString(),
                AethorArmAsciiProtocol.FormatRequest(
                    testCase.GetProperty("requestId").GetUInt32(),
                    testCase.GetProperty("operation").GetString()!,
                    fields));
        }
    }

    [Fact]
    public void CSharpCodecConsumesEveryLanguageNeutralFrameAndInvalidVector()
    {
        using var document = LoadVectors();
        foreach (var testCase in document.RootElement.GetProperty("frameCases").EnumerateArray())
        {
            var result = AethorArmAsciiProtocol.ParseFrame(testCase.GetProperty("line").GetString()!);
            Assert.True(result.IsValid);
            Assert.NotNull(result.Frame);
            Assert.Equal(testCase.GetProperty("expectedSequence").GetUInt32(), result.Frame.Sequence);
            Assert.Equal(testCase.GetProperty("expectedSubject").GetString(), result.Frame.Subject);
            Assert.Equal(testCase.GetProperty("expectedKind").GetString(), KindCode(result.Frame.Kind));
        }

        foreach (var testCase in document.RootElement.GetProperty("invalidCases").EnumerateArray())
        {
            var result = AethorArmAsciiProtocol.ParseFrame(testCase.GetProperty("line").GetString()!);
            Assert.False(result.IsValid);
            Assert.Equal(testCase.GetProperty("expectedCode").GetString(), result.ContractCode);
        }
    }

    [Fact]
    public void FormatterRejectsDuplicateOrUnsafeFieldsAndUnsupportedOperations()
    {
        Assert.Throws<ArgumentException>(() => AethorArmAsciiProtocol.FormatRequest(
            1,
            "GET_STATE",
            [new("key", "1"), new("key", "2")]));
        Assert.Throws<ArgumentException>(() => AethorArmAsciiProtocol.FormatRequest(
            1,
            "GET_STATE",
            [new("key", "a=b")]));
        Assert.Throws<ArgumentException>(() => AethorArmAsciiProtocol.FormatRequest(1, "REBOOT"));
        Assert.Throws<ArgumentOutOfRangeException>(() => AethorArmAsciiProtocol.FormatRequest(0, "GET_STATE"));
    }

    [Fact]
    public void DecoderHandlesFragmentsStickyFramesAndStrictCrLf()
    {
        var decoder = new AethorArmAsciiLineDecoder();
        Assert.Empty(decoder.Append(Ascii("REQ 2 GET_")));
        var records = decoder.Append(Ascii("JPOS *83EC\r\nERR 0 BAD_CRC *2657\n"));
        Assert.Equal(2, records.Count);
        Assert.All(records, record => Assert.Equal(AethorArmDecodedRecordKind.Line, record.Kind));
        Assert.Equal("REQ 2 GET_JPOS *83EC", records[0].Value);
        Assert.Equal("ERR 0 BAD_CRC *2657", records[1].Value);

        records = decoder.Append(Ascii("REQ 2\rGET_JPOS *83EC\n"));
        Assert.Single(records);
        Assert.Equal("control-character", records[0].Reason);
        Assert.Equal("REQ 2", records[0].Value);
    }

    [Fact]
    public void DecoderAcceptsAValidFrameAtEveryPossibleByteSplit()
    {
        const string line = "TEL 4294967295 JOINT_STATE t_us=183920040 q_deg=0,-15.012,0,0.004,20.001,0,4.995 present_mask=0x5B valid_mask=0x5B conflict_mask=0x00 unexpected_ids=none *9A9B";
        var bytes = Ascii(line + "\n");
        for (var split = 0; split <= bytes.Length; split++)
        {
            var decoder = new AethorArmAsciiLineDecoder();
            var records = decoder.Append(bytes.AsSpan(0, split)).Concat(decoder.Append(bytes.AsSpan(split))).ToArray();
            var record = Assert.Single(records);
            Assert.Equal(AethorArmDecodedRecordKind.Line, record.Kind);
            Assert.Equal(line, record.Value);
        }
    }

    [Fact]
    public void DecoderBoundsMalformedInputAndReportsIncompleteTail()
    {
        var decoder = new AethorArmAsciiLineDecoder();
        var overlong = Enumerable.Repeat((byte)'A', AethorArmAsciiProtocol.MaximumLineBytes + 32)
            .Append((byte)'\n')
            .ToArray();
        var records = decoder.Append(overlong);
        Assert.Single(records);
        Assert.Equal("overlong", records[0].Reason);
        Assert.Equal(AethorArmAsciiProtocol.MaximumLineBytes, records[0].Value.Length);

        records = decoder.Append([(byte)'R', (byte)'E', (byte)'Q', 0xff, (byte)'\n']);
        Assert.Single(records);
        Assert.Equal("non-ascii", records[0].Reason);

        Assert.Empty(decoder.Append(Ascii("partial")));
        var incomplete = decoder.Finish();
        Assert.NotNull(incomplete);
        Assert.Equal("incomplete", incomplete.Reason);
    }

    private static byte[] Ascii(string value) => Encoding.ASCII.GetBytes(value);

    private static JsonDocument LoadVectors()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Conformance", "aethor-arm-ascii-v1.vectors.json");
        return JsonDocument.Parse(File.ReadAllText(path));
    }

    private static string KindCode(AethorArmFrameKind kind) => kind switch
    {
        AethorArmFrameKind.Request => "REQ",
        AethorArmFrameKind.Acknowledgement => "ACK",
        AethorArmFrameKind.Response => "RSP",
        AethorArmFrameKind.Error => "ERR",
        AethorArmFrameKind.Done => "DONE",
        AethorArmFrameKind.Event => "EVT",
        AethorArmFrameKind.Telemetry => "TEL",
        _ => throw new InvalidOperationException("Unsupported frame kind")
    };
}
