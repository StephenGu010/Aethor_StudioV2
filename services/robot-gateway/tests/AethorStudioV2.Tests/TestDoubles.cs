using System.Collections.Concurrent;
using System.Text;
using System.Threading.Channels;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

internal sealed class FakeSerialPortCatalog(params string[] portNames) : ISerialPortCatalog
{
    public ValueTask<IReadOnlyList<SerialPortDescriptor>> ListAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult<IReadOnlyList<SerialPortDescriptor>>(
            portNames.Select(port => new SerialPortDescriptor(port, $"FAKE\\{port}", $"Fake {port}")).ToArray());
    }
}

internal sealed class FakeAsciiTransportFactory(Func<int, FakeAsciiTransport>? create = null) : IAsciiTransportFactory
{
    private readonly Func<int, FakeAsciiTransport> create = create ?? (_ => FakeAsciiTransport.WithDefaultStatus());
    private readonly ConcurrentQueue<FakeAsciiTransport> transports = new();
    private int createCount;

    public IReadOnlyList<FakeAsciiTransport> Transports => [.. transports];

    public IAsciiTransport Create(string portName, int baudRate)
    {
        Assert.Equal(DummyAsciiProtocol.BaudRate, baudRate);
        var transport = create(Interlocked.Increment(ref createCount));
        transport.AssignedPortName = portName;
        transports.Enqueue(transport);
        return transport;
    }
}

internal sealed class FakeAsciiTransport : IAsciiTransport
{
    private readonly Channel<byte[]> inbound = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(128)
    {
        SingleReader = true,
        SingleWriter = false,
        FullMode = BoundedChannelFullMode.Wait
    });
    private readonly Func<string, int, IReadOnlyList<byte[]>> responseScript;
    private readonly TaskCompletionSource writeStarted =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource writeRelease =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private byte[]? activeChunk;
    private int activeChunkOffset;
    private int writeCount;
    private int writeAttemptCount;
    private bool disposed;

    public FakeAsciiTransport(Func<string, int, IReadOnlyList<byte[]>> responseScript)
    {
        this.responseScript = responseScript;
    }

    public static FakeAsciiTransport WithDefaultStatus() => new((query, _) => query switch
    {
        "#GETJPOS" => [Ascii("ok 1 -2 3 4 5 6\n")],
        "#GETMODE" => [Ascii("ok 2 INT_POINT\n")],
        "#GETENABLE" => [Ascii("ok 0\n")],
        _ => []
    });

    public string AssignedPortName { get; set; } = "COM4";
    public string PortName => AssignedPortName;
    public bool IsOpen { get; private set; }
    public bool FailOpen { get; init; }
    public bool BlockOpenUntilCancelled { get; init; }
    public bool IgnoreReadCancellation { get; init; }
    public bool BlockWritesUntilClose { get; init; }
    public bool IgnoreWriteCancellation { get; init; }
    public Task WriteStarted => writeStarted.Task;
    public int OpenCount { get; private set; }
    public int CloseCount { get; private set; }
    public int DisposeCount { get; private set; }
    public int WriteAttemptCount => Volatile.Read(ref writeAttemptCount);
    public ConcurrentQueue<Exception> WriteFailures { get; } = new();
    public ConcurrentQueue<string> Writes { get; } = new();

    public async ValueTask OpenAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        OpenCount++;
        if (FailOpen)
        {
            throw new UnauthorizedAccessException("fake port occupied");
        }

        if (BlockOpenUntilCancelled)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
        }

        IsOpen = true;
    }

    public async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken)
    {
        if (!IsOpen)
        {
            throw new IOException("fake port closed");
        }

        if (activeChunk is null || activeChunkOffset >= activeChunk.Length)
        {
            try
            {
                activeChunk = await inbound.Reader.ReadAsync(IgnoreReadCancellation ? CancellationToken.None : cancellationToken).ConfigureAwait(false);
                activeChunkOffset = 0;
            }
            catch (ChannelClosedException exception) when (exception.InnerException is IOException ioException)
            {
                throw ioException;
            }
            catch (ChannelClosedException)
            {
                return 0;
            }
        }

        var count = Math.Min(buffer.Length, activeChunk.Length - activeChunkOffset);
        activeChunk.AsMemory(activeChunkOffset, count).CopyTo(buffer);
        activeChunkOffset += count;
        return count;
    }

    public async ValueTask WriteAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!IsOpen)
        {
            throw new IOException("fake port closed");
        }

        if (BlockWritesUntilClose)
        {
            writeStarted.TrySetResult();
            await writeRelease.Task
                .WaitAsync(IgnoreWriteCancellation ? CancellationToken.None : cancellationToken)
                .ConfigureAwait(false);
            if (!IsOpen)
            {
                throw new IOException("fake port closed while writing");
            }
        }

        Interlocked.Increment(ref writeAttemptCount);
        if (WriteFailures.TryDequeue(out var writeFailure))
        {
            throw writeFailure;
        }

        var text = Encoding.ASCII.GetString(payload.Span);
        var query = text.TrimEnd('\r', '\n');
        Writes.Enqueue(query);
        foreach (var chunk in responseScript(query, Interlocked.Increment(ref writeCount)))
        {
            if (!inbound.Writer.TryWrite(chunk))
            {
                throw new InvalidOperationException("fake inbound channel is full");
            }
        }

    }

    public ValueTask CloseAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (IsOpen)
        {
            CloseCount++;
            IsOpen = false;
            writeRelease.TrySetResult();
            inbound.Writer.TryComplete();
        }

        return ValueTask.CompletedTask;
    }

    public void PushInbound(string value)
    {
        if (!inbound.Writer.TryWrite(Ascii(value)))
        {
            throw new InvalidOperationException("fake inbound channel is full");
        }
    }

    public void ReleaseWrites() => writeRelease.TrySetResult();

    public ValueTask DisposeAsync()
    {
        if (!disposed)
        {
            disposed = true;
            DisposeCount++;
            IsOpen = false;
            writeRelease.TrySetResult();
            inbound.Writer.TryComplete();
        }

        return ValueTask.CompletedTask;
    }

    public void SimulateUnplug()
    {
        IsOpen = false;
        writeRelease.TrySetResult();
        inbound.Writer.TryComplete(new IOException("fake device unplugged"));
    }

    public static byte[] Ascii(string value) => Encoding.ASCII.GetBytes(value);
}

internal sealed class RecordingGatewayEventSink : IRobotGatewayEventSink
{
    public ConcurrentQueue<RobotSessionSnapshot> Sessions { get; } = new();
    public ConcurrentQueue<JointStateFrame> JointStates { get; } = new();
    public ConcurrentQueue<ProtocolFrame> ProtocolFrames { get; } = new();
    public ConcurrentQueue<CommandResult> CommandResults { get; } = new();
    public ConcurrentQueue<DirectCommandResult> DirectCommandResults { get; } = new();

    public ValueTask PublishSessionAsync(RobotSessionSnapshot snapshot, CancellationToken cancellationToken)
    {
        Sessions.Enqueue(snapshot);
        return ValueTask.CompletedTask;
    }

    public ValueTask PublishJointStateAsync(JointStateFrame frame, CancellationToken cancellationToken)
    {
        JointStates.Enqueue(frame);
        return ValueTask.CompletedTask;
    }

    public ValueTask PublishProtocolFrameAsync(ProtocolFrame frame, CancellationToken cancellationToken)
    {
        ProtocolFrames.Enqueue(frame);
        return ValueTask.CompletedTask;
    }

    public ValueTask PublishCommandResultAsync(CommandResult result, CancellationToken cancellationToken)
    {
        CommandResults.Enqueue(result);
        return ValueTask.CompletedTask;
    }

    public ValueTask PublishDirectCommandResultAsync(DirectCommandResult result, CancellationToken cancellationToken)
    {
        DirectCommandResults.Enqueue(result);
        return ValueTask.CompletedTask;
    }
}

internal sealed class RecordingGatewayDiagnostics : IGatewayDiagnostics
{
    public ConcurrentQueue<GatewayDiagnosticEvent> Events { get; } = new();

    public void Record(GatewayDiagnosticEvent diagnosticEvent) => Events.Enqueue(diagnosticEvent);
}

internal static class TestWait
{
    public static async Task UntilAsync(Func<bool> predicate, TimeSpan? timeout = null)
    {
        using var cancellation = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(3));
        while (!predicate())
        {
            await Task.Delay(10, cancellation.Token).ConfigureAwait(false);
        }
    }
}
