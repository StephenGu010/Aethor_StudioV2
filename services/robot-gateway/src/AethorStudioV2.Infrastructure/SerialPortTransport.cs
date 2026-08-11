using System.Buffers;
using System.IO.Ports;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Infrastructure;

public enum SerialPayloadAccess
{
    ReadOnly,
    Supervised,
    Engineering
}

public sealed class SerialPortTransportFactory(
    SerialPayloadAccess access = SerialPayloadAccess.ReadOnly,
    double? jointGroupSpeedLimitDegS = null) : IAsciiTransportFactory
{
    public IAsciiTransport Create(string portName, int baudRate) =>
        new SerialPortTransport(portName, baudRate, access, jointGroupSpeedLimitDegS);
}

public static class SerialPayloadPolicy
{
    private static readonly HashSet<string> AllowedPayloads =
    [
        DummyAsciiProtocol.EncodeQuery(DummyReadQuery.JointPositions),
        DummyAsciiProtocol.EncodeQuery(DummyReadQuery.Mode),
        DummyAsciiProtocol.EncodeQuery(DummyReadQuery.Enable)
    ];

    private static readonly HashSet<string> SupervisedSystemCommands =
    [
        DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Enable),
        DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Stop),
        DummyAsciiProtocol.FormatSystemCommand(DummySystemCommand.Disable)
    ];

    public static bool IsAllowed(
        ReadOnlySpan<byte> payload,
        SerialPayloadAccess access = SerialPayloadAccess.ReadOnly,
        double? jointGroupSpeedLimitDegS = null)
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

        var encoded = Encoding.ASCII.GetString(payload);
        if (AllowedPayloads.Contains(encoded))
        {
            return true;
        }

        if (access == SerialPayloadAccess.ReadOnly
            || !encoded.EndsWith(DummyAsciiProtocol.LineEnding, StringComparison.Ordinal)
            || encoded[..^DummyAsciiProtocol.LineEnding.Length].Contains('\r'))
        {
            return false;
        }

        var line = encoded[..^DummyAsciiProtocol.LineEnding.Length];
        if (SupervisedSystemCommands.Contains(line)
            || line == DummyAsciiProtocol.SafetyZeroCurrentLine
            || line is "#CMDMODE 1" or "#CMDMODE 2" or "#CMDMODE 3")
        {
            return true;
        }

        return IsAllowedJointGroup(line, jointGroupSpeedLimitDegS);
    }

    private static bool IsAllowedJointGroup(string line, double? jointGroupSpeedLimitDegS)
    {
        if (!line.StartsWith('>') || jointGroupSpeedLimitDegS is not { } speedLimit)
        {
            return false;
        }

        var tokens = line[1..].Split(',', StringSplitOptions.None);
        if (tokens.Length != DummyAsciiProtocol.JointCount + 1)
        {
            return false;
        }

        var values = new double[tokens.Length];
        for (var index = 0; index < tokens.Length; index++)
        {
            if (!double.TryParse(tokens[index], NumberStyles.Float, CultureInfo.InvariantCulture, out values[index])
                || !double.IsFinite(values[index]))
            {
                return false;
            }
        }

        for (var index = 0; index < DummyAsciiProtocol.JointCount; index++)
        {
            var limit = DummyJointLimits.All[index];
            if (values[index] < limit.LowerDeg || values[index] > limit.UpperDeg)
            {
                return false;
            }
        }

        return values[^1] > 0 && values[^1] <= speedLimit;
    }
}

public sealed class SerialPortTransport : IAsciiTransport
{
    private const int SerialReadTimeoutMilliseconds = 100;
    private readonly int baudRate;
    private readonly SerialPayloadAccess access;
    private readonly double? jointGroupSpeedLimitDegS;
    private readonly Func<string, int, ISerialPortConnection> connectionFactory;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private ISerialPortConnection? serialPort;
    private bool disposed;

    public SerialPortTransport(
        string portName,
        int baudRate,
        SerialPayloadAccess access = SerialPayloadAccess.ReadOnly,
        double? jointGroupSpeedLimitDegS = null) : this(
            portName,
            baudRate,
            access,
            jointGroupSpeedLimitDegS,
            static (name, rate) => new SystemSerialPortConnection(name, rate, SerialReadTimeoutMilliseconds))
    {
    }

    internal SerialPortTransport(
        string portName,
        int baudRate,
        SerialPayloadAccess access,
        double? jointGroupSpeedLimitDegS,
        Func<string, int, ISerialPortConnection> connectionFactory)
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
        this.access = access;
        this.jointGroupSpeedLimitDegS = jointGroupSpeedLimitDegS;
        this.connectionFactory = connectionFactory;
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
            var candidate = connectionFactory(PortName, baudRate);
            var openTask = Task.Run(candidate.Open, CancellationToken.None);
            try
            {
                await openTask.WaitAsync(cancellationToken).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();
                serialPort = candidate;
            }
            catch (OperationCanceledException)
            {
                // SerialPort.Open is synchronous and some Windows drivers can ignore
                // request cancellation. Start candidate disposal immediately so Close/
                // Dispose can interrupt the native open without holding the lifecycle
                // gate or the API request. The gateway quarantines further attempts
                // until restart, preventing abandoned open workers from accumulating.
                _ = AbortOpenAsync(candidate, openTask);
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

        if (buffer.Length == 0) return 0;

        byte[]? rented = null;
        ArraySegment<byte> segment;
        if (!MemoryMarshal.TryGetArray((ReadOnlyMemory<byte>)buffer, out segment)
            || segment.Array is null)
        {
            rented = ArrayPool<byte>.Shared.Rent(buffer.Length);
            segment = new(rented, 0, buffer.Length);
        }

        try
        {
            var count = await Task.Run(() => ReadUntilDataOrCancellation(
                    current,
                    segment.Array!,
                    segment.Offset,
                    buffer.Length,
                    cancellationToken),
                CancellationToken.None).ConfigureAwait(false);
            if (rented is not null)
            {
                rented.AsMemory(0, count).CopyTo(buffer);
            }
            return count;
        }
        finally
        {
            if (rented is not null) ArrayPool<byte>.Shared.Return(rented);
        }
    }

    public async ValueTask WriteAsync(ReadOnlyMemory<byte> payload, CancellationToken cancellationToken)
    {
        var current = Volatile.Read(ref serialPort);
        if (current?.IsOpen != true)
        {
            throw new IOException("Serial transport is not open");
        }

        if (!SerialPayloadPolicy.IsAllowed(payload.Span, access, jointGroupSpeedLimitDegS))
        {
            throw new InvalidOperationException("Serial payload policy rejected an untyped or unauthorized command");
        }

        cancellationToken.ThrowIfCancellationRequested();
        var encoded = payload.ToArray();
        await Task.Run(() => current.Write(encoded, 0, encoded.Length), CancellationToken.None)
            .ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
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
                await Task.Run(() => DisposeSerialPort(current), CancellationToken.None).ConfigureAwait(false);
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
                await Task.Run(() => DisposeSerialPort(current), CancellationToken.None).ConfigureAwait(false);
            }
        }
        finally
        {
            lifecycleGate.Release();
            lifecycleGate.Dispose();
        }
    }

    private static int ReadUntilDataOrCancellation(
        ISerialPortConnection serialPort,
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return serialPort.Read(buffer, offset, count);
            }
            catch (TimeoutException)
            {
                // A finite synchronous read timeout is intentional. System.IO.Ports
                // BaseStream.ReadAsync can ignore cancellation indefinitely on Windows;
                // bounded reads return ownership to the gateway at least every 100 ms.
            }
        }
    }

    private static void DisposeSerialPort(ISerialPortConnection serialPort)
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

    private static async Task AbortOpenAsync(ISerialPortConnection candidate, Task openTask)
    {
        try
        {
            await Task.Run(() => DisposeSerialPort(candidate), CancellationToken.None).ConfigureAwait(false);
        }
        catch
        {
            // The application-level timeout already records the failed open. This
            // cleanup path must observe every task without throwing on a finalizer or
            // thread-pool thread.
        }

        try
        {
            await openTask.ConfigureAwait(false);
        }
        catch
        {
            // Observe the abandoned synchronous open outcome after candidate disposal.
        }
    }
}

internal interface ISerialPortConnection : IDisposable
{
    bool IsOpen { get; }
    void Open();
    int Read(byte[] buffer, int offset, int count);
    void Write(byte[] buffer, int offset, int count);
    void Close();
}

internal sealed class SystemSerialPortConnection : ISerialPortConnection
{
    private readonly SerialPort serialPort;

    public SystemSerialPortConnection(string portName, int baudRate, int readTimeoutMilliseconds)
    {
        serialPort = new(portName, baudRate, Parity.None, 8, StopBits.One)
        {
            Encoding = Encoding.ASCII,
            NewLine = DummyAsciiProtocol.LineEnding,
            Handshake = Handshake.None,
            DtrEnable = false,
            RtsEnable = false,
            ReadTimeout = readTimeoutMilliseconds,
            WriteTimeout = 2_000
        };
    }

    public bool IsOpen => serialPort.IsOpen;
    public void Open() => serialPort.Open();
    public int Read(byte[] buffer, int offset, int count) => serialPort.Read(buffer, offset, count);
    public void Write(byte[] buffer, int offset, int count) => serialPort.Write(buffer, offset, count);
    public void Close() => serialPort.Close();
    public void Dispose() => serialPort.Dispose();
}
