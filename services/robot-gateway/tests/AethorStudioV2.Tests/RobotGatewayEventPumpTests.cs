using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class RobotGatewayEventPumpTests
{
    [Fact]
    public void EventTimeoutOptionsRejectValuesOutsideTheBoundedRange()
    {
        var publishTooShort = Options() with
        {
            EventPublishTimeout = TimeSpan.FromMilliseconds(99)
        };
        var drainTooLong = Options() with
        {
            EventShutdownDrainTimeout = TimeSpan.FromSeconds(31)
        };

        Assert.Throws<ArgumentOutOfRangeException>(publishTooShort.Validate);
        Assert.Throws<ArgumentOutOfRangeException>(drainTooLong.Validate);
    }

    [Fact]
    public async Task DisposeIsBoundedWhenEventSinkIgnoresCancellation()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        var sink = new BlockingGatewayEventSink();
        var diagnostics = new RecordingGatewayDiagnostics();
        var gateway = new RobotGateway(
            new FakeAsciiTransportFactory(_ => transport),
            new FakeSerialPortCatalog("COM4"),
            sink,
            diagnostics,
            TimeProvider.System,
            Options());
        await gateway.ConnectAsync(
            new("COM4", GatewayContractV1.DummyProfileId),
            CancellationToken.None);
        await sink.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        await gateway.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(3));

        Assert.False(transport.IsOpen);
        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
        Assert.Contains(
            diagnostics.Events,
            item => item.EventName == "events.shutdown.timeout");
    }

    [Fact]
    public async Task PublishTimeoutStopsPumpWithoutStartingMoreBlockedPublishes()
    {
        var transport = FakeAsciiTransport.WithDefaultStatus();
        var sink = new BlockingGatewayEventSink();
        var diagnostics = new RecordingGatewayDiagnostics();
        var gateway = new RobotGateway(
            new FakeAsciiTransportFactory(_ => transport),
            new FakeSerialPortCatalog("COM4"),
            sink,
            diagnostics,
            TimeProvider.System,
            Options() with
            {
                EventPublishTimeout = TimeSpan.FromMilliseconds(100),
                EventShutdownDrainTimeout = TimeSpan.FromSeconds(1)
            });
        await gateway.ConnectAsync(
            new("COM4", GatewayContractV1.DummyProfileId),
            CancellationToken.None);
        await sink.Entered.Task.WaitAsync(TimeSpan.FromSeconds(1));

        await TestWait.UntilAsync(
            () => diagnostics.Events.Any(item => item.EventName == "events.publish.timeout"));
        await Task.Delay(250);

        Assert.Equal(1, sink.CallCount);
        await gateway.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(1, sink.CallCount);
    }

    private static RobotGatewayOptions Options() => new()
    {
        JointPollInterval = TimeSpan.FromMilliseconds(50),
        StatusPollInterval = TimeSpan.FromMilliseconds(50),
        PollInterval = TimeSpan.FromMilliseconds(50),
        QueryTimeout = TimeSpan.FromMilliseconds(50),
        ConsecutiveTimeoutLimit = 3,
        ProtocolFrameCapacity = 64,
        EventQueueCapacity = 16,
        EventPublishTimeout = TimeSpan.FromSeconds(5),
        EventShutdownDrainTimeout = TimeSpan.FromMilliseconds(100),
        ReadBufferBytes = 256,
        CommandHistoryCapacity = 16
    };

    private sealed class BlockingGatewayEventSink : IRobotGatewayEventSink
    {
        private readonly TaskCompletionSource never =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Entered { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int CallCount => Volatile.Read(ref callCount);

        private int callCount;

        public ValueTask PublishSessionAsync(
            RobotSessionSnapshot snapshot,
            CancellationToken cancellationToken) => Block();

        public ValueTask PublishJointStateAsync(
            JointStateFrame frame,
            CancellationToken cancellationToken) => Block();

        public ValueTask PublishProtocolFrameAsync(
            ProtocolFrame frame,
            CancellationToken cancellationToken) => Block();

        public ValueTask PublishCommandResultAsync(
            CommandResult result,
            CancellationToken cancellationToken) => Block();

        public ValueTask PublishDirectCommandResultAsync(
            DirectCommandResult result,
            CancellationToken cancellationToken) => Block();

        private ValueTask Block()
        {
            Interlocked.Increment(ref callCount);
            Entered.TrySetResult();
            return new(never.Task);
        }
    }
}
