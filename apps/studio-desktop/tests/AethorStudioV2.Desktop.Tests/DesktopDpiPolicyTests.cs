namespace AethorStudioV2.Desktop.Tests;

public sealed class DesktopDpiPolicyTests
{
    [Theory]
    [InlineData(96, 8)]
    [InlineData(120, 10)]
    [InlineData(144, 12)]
    [InlineData(192, 16)]
    public void ResizeBorderScalesAcrossSupportedWindowsDpiLevels(int dpi, int expectedPixels)
    {
        Assert.Equal(expectedPixels, DesktopDpiPolicy.GetResizeBorderPixels(dpi));
    }

    [Fact]
    public void ResizeBorderRejectsInvalidDpi()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => DesktopDpiPolicy.GetResizeBorderPixels(0));
    }
}
