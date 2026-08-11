using System.Diagnostics;
using AethorStudioV2.Infrastructure;

namespace AethorStudioV2.Tests;

public sealed class SerialPortTransportTests
{
    [Fact]
    public async Task CancelledReadReturnsOwnershipWithinOneFiniteReadWindow()
    {
        var connection = new TimeoutSerialPortConnection(TimeSpan.FromMilliseconds(20));
        await using var transport = new SerialPortTransport(
            "COM4",
            115200,
            SerialPayloadAccess.Engineering,
            100,
            (_, _) => connection);
        await transport.OpenAsync(CancellationToken.None);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(35));
        var elapsed = Stopwatch.StartNew();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await transport.ReadAsync(new byte[64], cancellation.Token));
        elapsed.Stop();
        await transport.CloseAsync(CancellationToken.None);

        Assert.True(elapsed.Elapsed < TimeSpan.FromMilliseconds(250), $"Read cancellation took {elapsed.Elapsed}");
        Assert.Equal(0, connection.ActiveOperations);
        Assert.Equal(1, connection.CloseCount);
        Assert.False(connection.IsOpen);
    }

    [Fact]
    public async Task CancelledNativeOpenStartsCandidateDisposalAndReturnsPromptly()
    {
        var connection = new BlockingOpenSerialPortConnection();
        await using var transport = new SerialPortTransport(
            "COM4",
            115200,
            SerialPayloadAccess.ReadOnly,
            null,
            (_, _) => connection);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var elapsed = Stopwatch.StartNew();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await transport.OpenAsync(cancellation.Token));
        elapsed.Stop();
        await connection.DisposeObserved.Task.WaitAsync(TimeSpan.FromSeconds(1));
        await connection.OpenReturned.Task.WaitAsync(TimeSpan.FromSeconds(1));

        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(1), $"Open cancellation took {elapsed.Elapsed}");
        Assert.Equal(1, connection.DisposeCount);
        Assert.False(transport.IsOpen);
    }

    private sealed class TimeoutSerialPortConnection(TimeSpan readWindow) : ISerialPortConnection
    {
        private int activeOperations;

        public bool IsOpen { get; private set; }
        public int ActiveOperations => Volatile.Read(ref activeOperations);
        public int CloseCount { get; private set; }

        public void Open() => IsOpen = true;

        public int Read(byte[] buffer, int offset, int count)
        {
            Interlocked.Increment(ref activeOperations);
            try
            {
                Thread.Sleep(readWindow);
                throw new TimeoutException("finite fake read window");
            }
            finally
            {
                Interlocked.Decrement(ref activeOperations);
            }
        }

        public void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public void Close()
        {
            if (!IsOpen) return;
            IsOpen = false;
            CloseCount += 1;
        }

        public void Dispose() => IsOpen = false;
    }

    private sealed class BlockingOpenSerialPortConnection : ISerialPortConnection
    {
        private readonly ManualResetEventSlim releaseOpen = new(false);
        private int disposeCount;

        public bool IsOpen => false;
        public int DisposeCount => Volatile.Read(ref disposeCount);
        public TaskCompletionSource DisposeObserved { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource OpenReturned { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void Open()
        {
            releaseOpen.Wait();
            OpenReturned.TrySetResult();
            throw new ObjectDisposedException(nameof(BlockingOpenSerialPortConnection));
        }

        public int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public void Close() => throw new NotSupportedException();

        public void Dispose()
        {
            if (Interlocked.Increment(ref disposeCount) != 1) return;
            releaseOpen.Set();
            DisposeObserved.TrySetResult();
        }
    }
}
