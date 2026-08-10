namespace AethorStudioV2.Desktop;

public static class DesktopDpiPolicy
{
    public const int BaselineDpi = 96;
    public const int LogicalResizeBorderPixels = 8;

    public static int GetResizeBorderPixels(int deviceDpi)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(deviceDpi);
        return Math.Max(6, (int)Math.Round(
            LogicalResizeBorderPixels * deviceDpi / (double)BaselineDpi,
            MidpointRounding.AwayFromZero));
    }
}
