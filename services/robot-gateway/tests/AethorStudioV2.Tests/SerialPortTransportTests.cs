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
}
