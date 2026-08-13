using System.Collections.Concurrent;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class DummySerialSessionTests
{
    [Fact]
    public async Task TransactionUsesOneDecoderAndMatchesFragmentedResponse()
    {
        var observed = new ConcurrentQueue<DummyResponse>();
        var writes = new ConcurrentQueue<DummySerialWrite>();
        var transport = new FakeAsciiTransport((line, _) => line == "#GETJPOS"
            ? [FakeAsciiTransport.Ascii("ok 1 2 "), FakeAsciiTransport.Ascii("3 4 5 6\n")]
            : []);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport, observed, writes);

        var response = await session.TransactAsync(
            "poll-1",
            "#GETJPOS",
            "query",
            "session-1",
            candidate => candidate.Kind == DummyResponseKind.JointPositions,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(3),
            TimeSpan.FromSeconds(3),
            CancellationToken.None);

        Assert.Equal(DummyResponseKind.JointPositions, response.Kind);
        Assert.Equal([1d, 2d, 3d, 4d, 5d, 6d], response.PositionsDeg);
        Assert.Single(observed);
        Assert.Equal("poll-1", Assert.Single(writes).WorkId);
    }

    [Fact]
    public async Task UnobservedWriteCompletesWithoutAnyDeviceReply()
    {
        var writes = new ConcurrentQueue<DummySerialWrite>();
        var transport = new FakeAsciiTransport((_, _) => []);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport, writes: writes);

        var ticket = session.QueueUnobserved(
            "terminal-1",
            "#GETMODE",
            "engineeringQuery",
            "session-1",
            SerialWorkPriority.Interactive,
            TimeSpan.FromSeconds(1));

        Assert.True(ticket.Accepted);
        Assert.Equal(SerialWriteOutcome.Written, (await ticket.Completion!).Outcome);
        Assert.Equal(["#GETMODE"], transport.Writes);
        Assert.Equal("terminal-1", Assert.Single(writes).WorkId);
    }

    [Fact]
    public async Task NormalTransactionsAreSerializedByTheResponseFence()
    {
        var transport = new FakeAsciiTransport((line, _) => line == "#GETMODE"
            ? []
            : [FakeAsciiTransport.Ascii("ok 0\n")]);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);

        var first = session.TransactAsync(
            "first",
            "#GETMODE",
            "query",
            "session-1",
            response => response.Kind == DummyResponseKind.Mode,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromMilliseconds(80),
            CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Count == 1);
        var second = session.TransactAsync(
            "second",
            "#GETENABLE",
            "query",
            "session-1",
            response => response.Kind == DummyResponseKind.Enable,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1),
            CancellationToken.None);

        await Task.Delay(30);
        Assert.Equal(["#GETMODE"], transport.Writes);
        await Assert.ThrowsAsync<GatewayQueryTimeoutException>(() => first);
        Assert.Equal(DummyResponseKind.Enable, (await second).Kind);
        Assert.Equal(["#GETMODE", "#GETENABLE"], transport.Writes);
    }

    [Fact]
    public async Task TransactionCannotConsumeAResponseBeforeItsPayloadIsPhysicallyWritten()
    {
        var observed = new ConcurrentQueue<DummyResponse>();
        var transport = new FakeAsciiTransport((line, _) => line == "#GETMODE"
            ? [FakeAsciiTransport.Ascii("ok 3 CONT_TRAJ\n")]
            : [])
        {
            BlockWritesUntilClose = true
        };
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport, observed);

        var blocker = session.QueueUnobserved(
            "terminal-write",
            "!START",
            "engineeringCommand",
            "session-1",
            SerialWorkPriority.Interactive,
            TimeSpan.FromSeconds(1));
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));

        var transaction = session.TransactAsync(
            "mode-query",
            "#GETMODE",
            "query",
            "session-1",
            response => response.Kind == DummyResponseKind.Mode,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(3),
            TimeSpan.FromSeconds(3),
            CancellationToken.None);
        await transport.WriteStarted.WaitAsync(TimeSpan.FromSeconds(1));

        transport.PushInbound("ok 2 INT_POINT\n");
        await TestWait.UntilAsync(() => observed.Count == 1);
        Assert.False(transaction.IsCompleted);

        transport.ReleaseWrites();
        Assert.Equal(SerialWriteOutcome.Written, (await blocker.Completion!).Outcome);
        var response = await transaction.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(3, response.Mode);
        Assert.Equal(["!START", "#GETMODE"], transport.Writes);
    }

    [Fact]
    public async Task SafetyTransactionPreemptsAWaitingNormalFence()
    {
        var transport = new FakeAsciiTransport((line, _) => line == "!STOP"
            ? [FakeAsciiTransport.Ascii("Stopped ok\n")]
            : []);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = CreateSession(transport);

        var normal = session.TransactAsync(
            "normal",
            "#GETMODE",
            "query",
            "session-1",
            response => response.Kind == DummyResponseKind.Mode,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1),
            CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Count == 1);

        var safety = session.TransactAsync(
            "safety",
            "!STOP",
            "safetyCommand",
            "session-1",
            response => response.Raw == "Stopped ok",
            SerialWorkPriority.Safety,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1),
            CancellationToken.None);

        await Assert.ThrowsAsync<DummyResponseFencePreemptedException>(() => normal);
        Assert.Equal("Stopped ok", (await safety).Raw);
        Assert.Equal(["#GETMODE", "!STOP"], transport.Writes);
    }

    [Fact]
    public async Task DisposeClosesTheOwnedSchedulerAndCancelsTheResponseFence()
    {
        var transport = new FakeAsciiTransport((_, _) => [])
        {
            IgnoreReadCancellation = true
        };
        await transport.OpenAsync(CancellationToken.None);
        var session = CreateSession(transport);
        var response = session.TransactAsync(
            "pending",
            "#GETMODE",
            "query",
            "session-1",
            candidate => candidate.Kind == DummyResponseKind.Mode,
            SerialWorkPriority.Telemetry,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(2),
            CancellationToken.None);
        await TestWait.UntilAsync(() => transport.Writes.Count == 1);

        await session.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => response);
        Assert.Equal(1, transport.CloseCount);
        Assert.Equal(1, transport.DisposeCount);
    }

    [Fact]
    public async Task ResponseObserverReceivesStructuredCommandOwnershipContext()
    {
        DummyResponseContext? observedContext = null;
        var transport = new FakeAsciiTransport((line, _) => line.StartsWith('>')
            ? [FakeAsciiTransport.Ascii("15\n")]
            : []);
        await transport.OpenAsync(CancellationToken.None);
        await using var session = new DummySerialSession(
            transport,
            (_, context) =>
            {
                observedContext = context;
                return false;
            },
            (_, _) => { },
            _ => { });

        var response = await session.TransactAsync(
            "joint-command",
            ">1,2,3,4,5,6,10",
            "jointGroupCommand",
            "session-1",
            candidate => candidate.Kind == DummyResponseKind.Queue,
            SerialWorkPriority.Interactive,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1),
            CancellationToken.None,
            commandId: "command-1");

        Assert.Equal(DummyResponseKind.Queue, response.Kind);
        Assert.Equal("joint-command", observedContext?.WorkId);
        Assert.Equal("command-1", observedContext?.CommandId);
    }

    private static DummySerialSession CreateSession(
        FakeAsciiTransport transport,
        ConcurrentQueue<DummyResponse>? observed = null,
        ConcurrentQueue<DummySerialWrite>? writes = null) =>
        new(
            transport,
            (response, _) =>
            {
                observed?.Enqueue(response);
                return false;
            },
            (_, _) => { },
            write => writes?.Enqueue(write));
}
