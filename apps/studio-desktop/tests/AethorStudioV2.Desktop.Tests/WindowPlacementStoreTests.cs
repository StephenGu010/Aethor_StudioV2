using System.Drawing;

namespace AethorStudioV2.Desktop.Tests;

public sealed class WindowPlacementStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "aethor-placement-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void NormalizeKeepsAVisibleWindowInsideTheBestMatchingMonitor()
    {
        var monitors = new[] { new Rectangle(0, 0, 1920, 1040), new Rectangle(1920, 0, 2560, 1400) };

        var result = WindowPlacementStore.Normalize(
            new Rectangle(2200, 100, 1600, 940),
            monitors,
            new Size(1120, 720));

        Assert.Equal(new Rectangle(2200, 100, 1600, 940), result);
    }

    [Fact]
    public void NormalizeRecoversAnOffscreenOrOversizedWindow()
    {
        var monitor = new Rectangle(-1920, 0, 1920, 1040);

        var result = WindowPlacementStore.Normalize(
            new Rectangle(9000, 9000, 5000, 4000),
            [monitor],
            new Size(1120, 720));

        Assert.Equal(monitor, result);
    }

    [Fact]
    public void SaveAndLoadRoundTripVersionedPlacementAtomically()
    {
        var path = Path.Combine(root, "window-placement.v1.json");
        var expected = new Rectangle(100, 120, 1500, 880);

        WindowPlacementStore.Save(path, expected, maximized: true);
        var loaded = WindowPlacementStore.TryLoad(
            path,
            [new Rectangle(0, 0, 1920, 1040)],
            new Size(1120, 720),
            out var actual,
            out var maximized);

        Assert.True(loaded);
        Assert.Equal(expected, actual);
        Assert.True(maximized);
        Assert.Empty(Directory.GetFiles(root, "*.tmp"));
    }

    [Fact]
    public void TryLoadRejectsUnknownOrExpandedSchemas()
    {
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, "window-placement.v1.json");
        File.WriteAllText(path, "{\"version\":2,\"x\":0,\"y\":0,\"width\":1200,\"height\":800,\"maximized\":false}");
        Assert.False(WindowPlacementStore.TryLoad(path, [new Rectangle(0, 0, 1920, 1040)], new Size(1120, 720), out _, out _));

        File.WriteAllText(path, "{\"version\":1,\"x\":0,\"y\":0,\"width\":1200,\"height\":800,\"maximized\":false,\"future\":true}");
        Assert.False(WindowPlacementStore.TryLoad(path, [new Rectangle(0, 0, 1920, 1040)], new Size(1120, 720), out _, out _));
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
