using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class ReadOnlyRobotGatewayTests
{
    [Fact]
    public async Task HappyPathPublishesMeasuredStateWithoutAnyStateChangingCommand()
    {
        var transport = new FakeAsciiTransport((query, _) => query switch
        {
            "#GETJPOS" => [FakeAsciiTransport.Ascii("boot banner\n"), FakeAsciiTransport.Ascii("ok 1 -2"), FakeAsciiTransport.Ascii(" 3 4 5 6\n")],
            "#GETMODE" => [FakeAsciiTransport.Ascii("ok 2 INT_POINT\n")],
            "#GETENABLE" => [FakeAsciiTransport.Ascii("ok 0\n")],
            _ => []
        });
        var factory = new FakeAsciiTransportFactory(_ => transport);
        var events = new RecordingGatewayEventSink();
        await using var gateway = CreateGateway(factory, events: events);

        var connected = await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);
        Assert.Equal(ConnectionState.Connected, connected.ConnectionState);
        Assert.Equal(Validity.Stale, connected.Validity);

        await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Valid);
        var session = gateway.GetSession();
        var jointState = gateway.GetJointState();
        Assert.Equal(DataSource.Measured, session.Source);
        Assert.Equal(MotorState.Disabled, session.MotorState);
        Assert.Equal(2, session.ControlMode);
        Assert.Equal([1d, -2d, 3d, 4d, 5d, 6d], jointState.PositionsDeg);
        Assert.All(transport.Writes, write => Assert.Contains(write, gateway.Capabilities.AllowedQueries));
        Assert.DoesNotContain(transport.Writes, write => write.StartsWith('!') || write.StartsWith('>') || write.StartsWith('$'));
        Assert.Contains(events.ProtocolFrames, frame =>
            frame.Direction == ProtocolDirection.Tx
            && frame.Raw == "#GETJPOS"
            && frame.Source == DataSource.Commanded);
        Assert.Contains(events.ProtocolFrames, frame =>
            frame.Direction == ProtocolDirection.Rx
            && frame.ParsedKind == "jointPositions"
            && frame.Source == DataSource.Measured);

        var offline = await gateway.DisconnectAsync(CancellationToken.None);
        Assert.Equal(ConnectionState.Offline, offline.ConnectionState);
        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
    }

    [Fact]
    public async Task ConcurrentConnectIsRejectedAndCreatesOnlyOneTransport()
    {
        var factory = new FakeAsciiTransportFactory();
        await using var gateway = CreateGateway(factory);
        await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);

        await Assert.ThrowsAsync<GatewayConflictException>(() =>
            gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None));
        Assert.Single(factory.Transports);
        await gateway.DisconnectAsync(CancellationToken.None);
    }

    [Fact]
    public async Task OccupiedPortBecomesFaultedAndReleasesTheFailedTransport()
    {
        var occupied = new FakeAsciiTransport((_, _) => []) { FailOpen = true };
        var diagnostics = new RecordingGatewayDiagnostics();
        await using var gateway = CreateGateway(new FakeAsciiTransportFactory(_ => occupied), diagnostics: diagnostics);

        await Assert.ThrowsAsync<GatewayDependencyException>(() =>
            gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None));
        Assert.Equal(ConnectionState.Faulted, gateway.GetSession().ConnectionState);
        Assert.Equal(1, occupied.DisposeCount);
        Assert.Contains(diagnostics.Events, item => item.EventName == "serial.open.failed");
    }

    [Fact]
    public async Task UnplugImmediatelyInvalidatesStateAndReleasesOwnership()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        await using var gateway = CreateGateway(new FakeAsciiTransportFactory(_ => transport));
        await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);
        await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Valid);

        transport.SimulateUnplug();
        await TestWait.UntilAsync(() => gateway.GetSession().ConnectionState == ConnectionState.Faulted);
        Assert.Equal(Validity.Invalid, gateway.GetSession().Validity);
        Assert.Equal(Validity.Unavailable, gateway.GetJointState().Validity);
        Assert.Equal(1, transport.DisposeCount);
    }

    [Fact]
    public async Task ThreeBoundedTimeoutsFaultTheSessionInsteadOfRetryingForever()
    {
        var silent = new FakeAsciiTransport((_, _) => []);
        var options = FastOptions() with { ConsecutiveTimeoutLimit = 3 };
        await using var gateway = CreateGateway(new FakeAsciiTransportFactory(_ => silent), options: options);
        await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);

        await TestWait.UntilAsync(() => gateway.GetSession().ConnectionState == ConnectionState.Faulted);
        Assert.Equal(3, silent.Writes.Count);
        Assert.Equal(1, silent.DisposeCount);
        var timeoutFrames = gateway.GetProtocolFrames(100)
            .Where(frame => frame.ParsedKind == "queryTimeout")
            .ToArray();
        Assert.Equal(3, timeoutFrames.Length);
        Assert.All(timeoutFrames, frame =>
        {
            Assert.Equal(ProtocolDirection.Error, frame.Direction);
            Assert.Equal(DataSource.Unavailable, frame.Source);
        });
    }

    [Fact]
    public async Task DisconnectCancelsHalfFrameAndLeavesNoReaderOrHandle()
    {
        var partial = new FakeAsciiTransport((query, _) => query == "#GETJPOS"
            ? [FakeAsciiTransport.Ascii("ok 1 2 3")]
            : []);
        await using var gateway = CreateGateway(new FakeAsciiTransportFactory(_ => partial));
        await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);
        await TestWait.UntilAsync(() => !partial.Writes.IsEmpty);

        var result = await gateway.DisconnectAsync(CancellationToken.None);
        Assert.Equal(ConnectionState.Offline, result.ConnectionState);
        Assert.Equal(1, partial.CloseCount);
        Assert.Equal(1, partial.DisposeCount);
        Assert.Contains(gateway.GetProtocolFrames(100), frame => frame.ParsedKind == "incomplete");
    }

    [Fact]
    public async Task RepeatedConnectDisconnectReturnsToStableResourceCounts()
    {
        var factory = new FakeAsciiTransportFactory();
        await using var gateway = CreateGateway(factory);
        for (var iteration = 0; iteration < 3; iteration++)
        {
            await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);
            await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Valid);
            await gateway.DisconnectAsync(CancellationToken.None);
        }

        Assert.Equal(3, factory.Transports.Count);
        Assert.All(factory.Transports, transport =>
        {
            Assert.Equal(1, transport.OpenCount);
            Assert.Equal(1, transport.CloseCount);
            Assert.Equal(1, transport.DisposeCount);
        });
    }

    [Fact]
    public async Task ProtocolHistoryIsBoundedAndRetainsNewestEvidence()
    {
        var noisy = new FakeAsciiTransport((query, _) =>
        {
            var chunks = Enumerable.Range(0, 40)
                .Select(index => FakeAsciiTransport.Ascii($"noise-{index}\n"))
                .ToList();
            chunks.Add(FakeAsciiTransport.Ascii(query switch
            {
                "#GETJPOS" => "ok 1 2 3 4 5 6\n",
                "#GETMODE" => "ok 1 SEQ_POINT\n",
                _ => "ok 0\n"
            }));
            return chunks;
        });
        await using var gateway = CreateGateway(
            new FakeAsciiTransportFactory(_ => noisy),
            options: FastOptions() with { ProtocolFrameCapacity = 32 });
        await gateway.ConnectAsync(new("COM4", GatewayContractV1.DummyProfileId), CancellationToken.None);
        await TestWait.UntilAsync(() => gateway.GetSession().Validity == Validity.Valid);

        var frames = gateway.GetProtocolFrames(100);
        Assert.Equal(32, frames.Count);
        Assert.Contains(frames, frame => frame.ParsedKind == "enable");
    }

    [Theory]
    [InlineData("COM0", "dummy-6dof")]
    [InlineData("COM4", "other-profile")]
    [InlineData("/dev/ttyUSB0", "dummy-6dof")]
    public async Task InvalidConnectionIdentityIsRejectedBeforeTransportCreation(string portName, string profileId)
    {
        var factory = new FakeAsciiTransportFactory();
        await using var gateway = CreateGateway(factory);
        await Assert.ThrowsAsync<GatewayValidationException>(() =>
            gateway.ConnectAsync(new(portName, profileId), CancellationToken.None));
        Assert.Empty(factory.Transports);
    }

    private static ReadOnlyRobotGateway CreateGateway(
        FakeAsciiTransportFactory factory,
        RecordingGatewayEventSink? events = null,
        RecordingGatewayDiagnostics? diagnostics = null,
        ReadOnlyGatewayOptions? options = null) => new(
            factory,
            new FakeSerialPortCatalog("COM4"),
            events,
            diagnostics,
            TimeProvider.System,
            options ?? FastOptions());

    private static ReadOnlyGatewayOptions FastOptions() => new()
    {
        PollInterval = TimeSpan.FromMilliseconds(50),
        QueryTimeout = TimeSpan.FromMilliseconds(50),
        ConsecutiveTimeoutLimit = 3,
        ProtocolFrameCapacity = 256,
        EventQueueCapacity = 64,
        ReadBufferBytes = 256
    };
}
