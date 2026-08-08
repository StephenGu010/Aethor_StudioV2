using System.IO.Ports;
using System.Text;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Infrastructure;

public sealed class SerialPortTransportFactory : IAsciiTransportFactory
{
    public IAsciiTransport Create(string portName, int baudRate) => new SerialPortTransport(portName, baudRate);
}

public static class ReadOnlySerialPayloadPolicy
{
    private static readonly HashSet<string> AllowedPayloads =
    [
        DummyAsciiProtocol.EncodeQuery(DummyReadQuery.JointPositions),
        DummyAsciiProtocol.EncodeQuery(DummyReadQuery.Mode),
        DummyAsciiProtocol.EncodeQuery(DummyReadQuery.Enable)
    ];

    public static bool IsAllowed(ReadOnlySpan<byte> payload)
    {
        if (payload.Length is < 2 or > DummyAsciiProtocol.MaximumLineCharacters + 1)
        {
            return false;
        }

        foreach (var value in payload)
        {
            if (value > 0x7f)
            {
                return false;
            }
        }

        return AllowedPayloads.Contains(Encoding.ASCII.GetString(payload));
    }
}

public sealed class SerialPortTransport : IAsciiTransport
{
    private readonly int baudRate;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private SerialPort? serialPort;
    private bool disposed;

    public SerialPortTransport(string portName, int baudRate)
    {
        if (string.IsNullOrWhiteSpace(portName))
        {
            throw new ArgumentException("Port name is required", nameof(portName));
        }

        if (baudRate != DummyAsciiProtocol.BaudRate)
        {
            throw new ArgumentOutOfRangeException(nameof(baudRate), "Dummy ASCII v1 requires 115200 baud");
        }

        PortName = portName;
        this.baudRate = baudRate;
    }

    public string PortName { get; }

    public bool IsOpen => Volatile.Read(ref serialPort)?.IsOpen == true;

    public async ValueTask OpenAsync(CancellationToken cancellationToken)
    {
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (serialPort is not null)
            {
                throw new InvalidOperationException("Serial transport is already open");
            }

            cancellationToken.ThrowIfCancellationRequested();
            var candidate = CreateSerialPort();
            var openTask = Task.Run(candidate.Open, CancellationToken.None);
            try
            {
                await openTask.WaitAsync(cancellationToken).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();
                serialPort = candidate;
            }
            catch (OperationCanceledException)
            {
                _ = openTask.ContinueWith(
                    static (_, state) => DisposeSerialPort((SerialPort)state!),
                    candidate,
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
                throw;
            }
            catch
            {
                DisposeSerialPort(candidate);
                throw;
            }
        }
        finally
        {
            lifecycleGate.Release();
        }
    }

    public async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken)
    {
        var current = Volatile.Read(ref serialPort);
        if (current?.IsOpen != true)
        {
            throw new IOException("Serial transport is not open");
        }

        return await current.BaseStream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
    }

    public async ValueTask WriteAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken)
    {
        var current = Volatile.Read(ref serialPort);
        if (current?.IsOpen != true)
        {
            throw new IOException("Serial transport is not open");
        }

        if (!ReadOnlySerialPayloadPolicy.IsAllowed(payload.Span))
        {
            throw new InvalidOperationException("Phase 4 serial transport rejected a non-query payload");
        }

        await current.BaseStream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
        await current.BaseStream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    public async ValueTask CloseAsync(CancellationToken cancellationToken)
    {
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = serialPort;
            serialPort = null;
            if (current is not null)
            {
                DisposeSerialPort(current);
            }
        }
        finally
        {
            lifecycleGate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await lifecycleGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            var current = serialPort;
            serialPort = null;
            if (current is not null)
            {
                DisposeSerialPort(current);
            }
        }
        finally
        {
            lifecycleGate.Release();
            lifecycleGate.Dispose();
        }
    }

    private SerialPort CreateSerialPort() => new(PortName, baudRate, Parity.None, 8, StopBits.One)
    {
        Encoding = Encoding.ASCII,
        NewLine = DummyAsciiProtocol.LineEnding,
        Handshake = Handshake.None,
        DtrEnable = false,
        RtsEnable = false,
        ReadTimeout = SerialPort.InfiniteTimeout,
        WriteTimeout = 2_000
    };

    private static void DisposeSerialPort(SerialPort serialPort)
    {
        try
        {
            if (serialPort.IsOpen)
            {
                serialPort.Close();
            }
        }
        finally
        {
            serialPort.Dispose();
        }
    }
}
