using System.IO.Ports;
using AethorStudioV2.Application;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Infrastructure;

public sealed class WindowsSerialPortCatalog : ISerialPortCatalog
{
    public ValueTask<IReadOnlyList<SerialPortDescriptor>> ListAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows())
        {
            return ValueTask.FromResult<IReadOnlyList<SerialPortDescriptor>>([]);
        }

        var ports = SerialPort.GetPortNames()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(PortNumber)
            .ThenBy(portName => portName, StringComparer.OrdinalIgnoreCase)
            .Select(portName => new SerialPortDescriptor(portName, HardwareId: null, DisplayName: portName))
            .ToArray();
        return ValueTask.FromResult<IReadOnlyList<SerialPortDescriptor>>(ports);
    }

    private static int PortNumber(string portName) =>
        portName.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
        && int.TryParse(portName.AsSpan(3), out var number)
            ? number
            : int.MaxValue;
}
