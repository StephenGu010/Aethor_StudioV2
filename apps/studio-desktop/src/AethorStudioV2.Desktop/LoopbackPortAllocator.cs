using System.Net;
using System.Net.Sockets;

namespace AethorStudioV2.Desktop;

public static class LoopbackPortAllocator
{
    public static int GetAvailablePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}
