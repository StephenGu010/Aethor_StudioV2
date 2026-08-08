using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace AethorStudioV2.Api;

public sealed record GatewayHostOptions(
    int Port,
    string SessionToken,
    string TokenSource,
    IReadOnlyList<string> DevelopmentOrigins)
{
    public const int DefaultPort = 5127;

    public static GatewayHostOptions FromConfiguration(IConfiguration configuration, IHostEnvironment environment)
    {
        var port = int.TryParse(configuration["PORT"], out var configuredPort)
            ? configuredPort
            : DefaultPort;
        var token = configuration["SESSION_TOKEN"] ?? string.Empty;
        var tokenSource = configuration["TOKEN_SOURCE"]?.Trim().ToLowerInvariant() ?? "development";
        var origins = (configuration["DEV_ORIGINS"] ?? "http://127.0.0.1:5173;http://localhost:5173")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var result = new GatewayHostOptions(port, token, tokenSource, origins);
        result.Validate(environment.IsDevelopment());
        return result;
    }

    public void Validate(bool isDevelopment)
    {
        if (Port is < 1024 or > 65535)
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_PORT must be between 1024 and 65535");
        }

        if (SessionToken.Length is < 32 or > 256 || SessionToken.Any(character => character is < (char)0x21 or > (char)0x7e))
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_SESSION_TOKEN must contain 32-256 printable ASCII characters");
        }

        if (TokenSource is not ("development" or "desktop"))
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_TOKEN_SOURCE must be development or desktop");
        }

        if (!isDevelopment && TokenSource != "desktop")
        {
            throw new InvalidOperationException("Development session tokens are forbidden outside the Development environment");
        }

        foreach (var origin in DevelopmentOrigins)
        {
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https")
                || uri.AbsolutePath != "/"
                || !IsLoopbackHost(uri.Host))
            {
                throw new InvalidOperationException("Development CORS origins must be loopback HTTP(S) origins without a path");
            }
        }
    }

    private static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
        || (IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address));
}
