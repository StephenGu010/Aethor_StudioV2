using System.Text.Json;
using System.Text.Json.Serialization;

namespace AethorStudioV2.Desktop;

public sealed record DesktopWindowPlacementV1(
    int Version,
    int X,
    int Y,
    int Width,
    int Height,
    bool Maximized);

public static class WindowPlacementStore
{
    public const int CurrentVersion = 1;
    private const int MaximumFileBytes = 4096;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public static bool TryLoad(
        string path,
        IReadOnlyList<Rectangle> workingAreas,
        Size minimumSize,
        out Rectangle bounds,
        out bool maximized)
    {
        bounds = Rectangle.Empty;
        maximized = false;
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length > MaximumFileBytes || workingAreas.Count == 0) return false;
            var placement = JsonSerializer.Deserialize<DesktopWindowPlacementV1>(File.ReadAllText(path), JsonOptions);
            if (placement is null
                || placement.Version != CurrentVersion
                || placement.Width <= 0
                || placement.Height <= 0)
            {
                return false;
            }
            bounds = Normalize(
                new(placement.X, placement.Y, placement.Width, placement.Height),
                workingAreas,
                minimumSize);
            maximized = placement.Maximized;
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return false;
        }
    }

    public static Rectangle Normalize(Rectangle requested, IReadOnlyList<Rectangle> workingAreas, Size minimumSize)
    {
        if (workingAreas.Count == 0) throw new ArgumentException("At least one monitor working area is required", nameof(workingAreas));
        if (minimumSize.Width <= 0 || minimumSize.Height <= 0) throw new ArgumentOutOfRangeException(nameof(minimumSize));

        var target = workingAreas
            .OrderByDescending(area => IntersectionArea(requested, area))
            .First();
        var width = Math.Clamp(requested.Width, Math.Min(minimumSize.Width, target.Width), target.Width);
        var height = Math.Clamp(requested.Height, Math.Min(minimumSize.Height, target.Height), target.Height);
        var x = Math.Clamp(requested.X, target.Left, target.Right - width);
        var y = Math.Clamp(requested.Y, target.Top, target.Bottom - height);
        return new(x, y, width, height);
    }

    public static void Save(string path, Rectangle bounds, bool maximized)
    {
        if (!Path.IsPathFullyQualified(path)) throw new ArgumentException("Window placement path must be absolute", nameof(path));
        if (bounds.Width <= 0 || bounds.Height <= 0) throw new ArgumentOutOfRangeException(nameof(bounds));
        var parent = Path.GetDirectoryName(path) ?? throw new ArgumentException("Window placement path has no parent", nameof(path));
        Directory.CreateDirectory(parent);
        var temporaryPath = Path.Combine(parent, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            var placement = new DesktopWindowPlacementV1(
                CurrentVersion,
                bounds.X,
                bounds.Y,
                bounds.Width,
                bounds.Height,
                maximized);
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(placement, JsonOptions));
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static long IntersectionArea(Rectangle left, Rectangle right)
    {
        var intersection = Rectangle.Intersect(left, right);
        return (long)intersection.Width * intersection.Height;
    }
}
