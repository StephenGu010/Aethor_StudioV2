using System.Runtime.InteropServices;

namespace AethorStudioV2.Desktop;

internal static partial class NativeWindowCommands
{
    private const int WindowNcLeftButtonDown = 0x00A1;
    private const int HitCaption = 2;

    public static void BeginDrag(nint handle)
    {
        ReleaseCapture();
        SendMessage(handle, WindowNcLeftButtonDown, HitCaption, 0);
    }

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool ReleaseCapture();

    [LibraryImport("user32.dll", EntryPoint = "SendMessageW")]
    private static partial nint SendMessage(nint window, int message, nint wordParameter, nint longParameter);
}
