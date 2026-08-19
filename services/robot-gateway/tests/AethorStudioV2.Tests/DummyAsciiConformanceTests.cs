using System.Text;
using System.Text.Json;
using AethorStudioV2.Domain;
using AethorStudioV2.Infrastructure;

namespace AethorStudioV2.Tests;

public sealed class DummyAsciiConformanceTests
{
    [Fact]
    public void CSharpAdapterConsumesEveryLanguageNeutralResponseVector()
    {
        using var document = LoadVectors();
        foreach (var testCase in document.RootElement.GetProperty("responseCases").EnumerateArray())
        {
            var raw = testCase.GetProperty("raw").GetString()!;
            var expectedKind = testCase.GetProperty("expectedKind").GetString();
            Assert.Equal(expectedKind, DummyAsciiProtocol.ParseResponseLine(raw).ContractKind);
        }
    }

    [Fact]
    public void CSharpFormatterMatchesEveryLanguageNeutralJointGroupVector()
    {
        using var document = LoadVectors();
        foreach (var testCase in document.RootElement.GetProperty("formatCases").EnumerateArray())
        {
            var command = testCase.GetProperty("command");
            if (command.GetProperty("type").GetString() != "jointGroup") continue;
            var positions = command.GetProperty("positionsDeg").EnumerateArray()
                .Select(value => value.GetDouble())
                .ToArray();
            var speed = command.GetProperty("speedDegS").GetDouble();
            Assert.Equal(testCase.GetProperty("expectedLine").GetString(),
                DummyAsciiProtocol.FormatJointGroup(positions, speed));
        }
    }

    [Fact]
    public void PhaseFourFormatsOnlyTheThreeReadQueriesAndRejectsEveryOtherVector()
    {
        using var document = LoadVectors();
        foreach (var testCase in document.RootElement.GetProperty("formatCases").EnumerateArray())
        {
            var commandType = testCase.GetProperty("command").GetProperty("type").GetString();
            var expectedLine = testCase.GetProperty("expectedLine").GetString()!;
            if (commandType is "queryJointPositions" or "queryMode" or "queryEnable")
            {
                var query = commandType switch
                {
                    "queryJointPositions" => DummyReadQuery.JointPositions,
                    "queryMode" => DummyReadQuery.Mode,
                    _ => DummyReadQuery.Enable
                };
                Assert.Equal(expectedLine, DummyAsciiProtocol.FormatQuery(query));
                Assert.True(SerialPayloadPolicy.IsAllowed(Encoding.ASCII.GetBytes(expectedLine + "\n")));
            }
            else
            {
                Assert.False(SerialPayloadPolicy.IsAllowed(Encoding.ASCII.GetBytes(expectedLine + "\n")));
            }
        }

        foreach (var testCase in document.RootElement.GetProperty("invalidRawCases").EnumerateArray())
        {
            var raw = testCase.GetProperty("raw").GetString()!;
            Assert.False(SerialPayloadPolicy.IsAllowed(Encoding.ASCII.GetBytes(raw + "\n")));
        }
    }

    [Fact]
    public void SupervisedPolicyAllowsOnlyTypedBoundedHardwarePayloads()
    {
        const double speedLimit = 20;
        Assert.True(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes("!START\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
        Assert.True(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes("#CMDMODE 3\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
        Assert.True(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(">0,-1.25,2,3,4,5,10\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
        Assert.True(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(DummyAsciiProtocol.SafetyZeroCurrentLine + "\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));

        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes("!HOME\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes("!RESET\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));

        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(">0,-1.25,2,3,4,5,21\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(">0,-100,2,3,4,5,10\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes("#RGBMODE 1\n"),
            SerialPayloadAccess.Supervised,
            speedLimit));
    }

    [Fact]
    public void EngineeringParserAllowsOnlyTheBoundedDirectDebugSubset()
    {
        Assert.True(DummyAsciiProtocol.TryParseEngineeringCommand(
            ">0,-1.25,2,3,4,5,10",
            100,
            out var jointGroup,
            out _));
        Assert.Equal(DummyDirectCommandKind.JointGroup, jointGroup!.Kind);
        Assert.Equal(">0,-1.25,2,3,4,5,10", jointGroup.NormalizedLine);

        Assert.True(DummyAsciiProtocol.TryParseEngineeringCommand(" #GETJPOS ", 100, out var query, out _));
        Assert.Equal("#GETJPOS", query!.NormalizedLine);
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand("!HOME", 100, out _, out _));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand("!RESET", 100, out _, out _));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand("#RGBMODE 1", 100, out _, out _));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand("$0,0,0,0,0,0", 100, out _, out _));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand(">0,0,0,0,0,0", 100, out _, out _));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand(">0,0,0,0,0,0,101", 100, out _, out _));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand("#GETJPOS\n!START", 100, out _, out _));
    }

    [Fact]
    public void EngineeringParserPreservesFiniteDeviceAnglesWithoutInventedHostLimits()
    {
        Assert.True(DummyAsciiProtocol.TryParseEngineeringCommand(
            ">170,90,180,180,120,720,10",
            100,
            out var command,
            out _));
        Assert.Equal([170d, 90d, 180d, 180d, 120d, 720d], command!.PositionsDeg);

        Assert.True(DummyAsciiProtocol.TryParseEngineeringCommand(">181,95,-45,200,-150,900,10", 100, out var measured, out _));
        Assert.Equal([181d, 95d, -45d, 200d, -150d, 900d], measured!.PositionsDeg);
    }

    [Fact]
    public void MotionCommandsMustFitTheFirmwareQueueEntryInEveryCSharpLayer()
    {
        var valid = ">123456789012345,123456789012345,0,0,0,0,20";
        var overlong = ">1.23456789012345,1.23456789012345,1.23456789012345,1.23456789012345,0,0,20";

        Assert.True(valid.Length <= DummyAsciiProtocol.MaximumMotionLineCharacters);
        Assert.True(overlong.Length > DummyAsciiProtocol.MaximumMotionLineCharacters);
        Assert.Equal(valid, DummyAsciiProtocol.FormatJointGroup(
            [123456789012345d, 123456789012345d, 0, 0, 0, 0], 20));
        Assert.Throws<ArgumentException>(() => DummyAsciiProtocol.FormatJointGroup(
            [1.23456789012345d, 1.23456789012345d, 1.23456789012345d, 1.23456789012345d, 0, 0], 20));
        Assert.False(DummyAsciiProtocol.TryParseEngineeringCommand(overlong, 100, out _, out var error));
        Assert.Contains("63", error, StringComparison.Ordinal);
        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(overlong + "\n"),
            SerialPayloadAccess.Engineering,
            100));
    }

    [Fact]
    public void EngineeringTransportPolicyRetainsTheFirmwareInputCeiling()
    {
        Assert.True(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(">0,0,0,0,0,0,100\n"),
            SerialPayloadAccess.Engineering,
            100));
        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(">0,0,0,0,0,0,100.1\n"),
            SerialPayloadAccess.Engineering,
            100));
        Assert.False(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes("!HOME\n"),
            SerialPayloadAccess.Engineering,
            100));
        Assert.True(SerialPayloadPolicy.IsAllowed(
            Encoding.ASCII.GetBytes(">181,95,-45,200,-150,900,20\n"),
            SerialPayloadAccess.Engineering,
            100));
    }

    [Fact]
    public void DecoderHandlesFragmentsStickyLinesAndCrLf()
    {
        var decoder = new DummyAsciiLineDecoder();
        Assert.Empty(decoder.Append(FakeAsciiTransport.Ascii("ok 1 -2")));
        var records = decoder.Append(FakeAsciiTransport.Ascii(" 3 4 5 6\r\nok 2 INT_POINT\nok 0\r"));

        Assert.Equal(3, records.Count);
        Assert.All(records, record => Assert.Equal(DummyDecodedRecordKind.Line, record.Kind));
        Assert.Equal("ok 1 -2 3 4 5 6", records[0].Value);
        Assert.Equal("ok 2 INT_POINT", records[1].Value);
        Assert.Equal("ok 0", records[2].Value);
    }

    [Fact]
    public void DecoderBoundsMalformedInputAndReportsIncompleteTail()
    {
        var decoder = new DummyAsciiLineDecoder();
        var overlong = Enumerable.Repeat((byte)'A', DummyAsciiProtocol.MaximumLineCharacters + 1).Append((byte)'\n').ToArray();
        var records = decoder.Append(overlong);
        Assert.Single(records);
        Assert.Equal("overlong", records[0].Reason);
        Assert.True(records[0].Value.Length <= DummyAsciiProtocol.MaximumLineCharacters + 1);

        records = decoder.Append([(byte)'o', (byte)'k', 0xff, (byte)'\n']);
        Assert.Single(records);
        Assert.Equal("non-ascii", records[0].Reason);

        Assert.Empty(decoder.Append(FakeAsciiTransport.Ascii("partial")));
        var incomplete = decoder.Finish();
        Assert.NotNull(incomplete);
        Assert.Equal("incomplete", incomplete.Reason);
    }

    [Fact]
    public void SharedGatewaySchemaIsShippedBesideTheTestContract()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Conformance", "gateway-contracts-v1.schema.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        Assert.Equal("Aethor Studio V2 Gateway Contracts V1", document.RootElement.GetProperty("title").GetString());
        Assert.True(document.RootElement.GetProperty("$defs").TryGetProperty("RobotSessionSnapshot", out _));
    }

    private static JsonDocument LoadVectors()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Conformance", "dummy-ascii-v1.vectors.json");
        return JsonDocument.Parse(File.ReadAllText(path));
    }
}
