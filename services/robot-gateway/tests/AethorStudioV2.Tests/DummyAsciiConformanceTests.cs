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
                Assert.True(ReadOnlySerialPayloadPolicy.IsAllowed(Encoding.ASCII.GetBytes(expectedLine + "\n")));
            }
            else
            {
                Assert.False(ReadOnlySerialPayloadPolicy.IsAllowed(Encoding.ASCII.GetBytes(expectedLine + "\n")));
            }
        }

        foreach (var testCase in document.RootElement.GetProperty("invalidRawCases").EnumerateArray())
        {
            var raw = testCase.GetProperty("raw").GetString()!;
            Assert.False(ReadOnlySerialPayloadPolicy.IsAllowed(Encoding.ASCII.GetBytes(raw + "\n")));
        }
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
