using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Api;

public sealed record GatewayHostOptions(
    int Port,
    string SessionToken,
    string TokenSource,
    IReadOnlyList<string> DevelopmentOrigins,
    GatewayCommandPolicy CommandPolicy = GatewayCommandPolicy.Disabled,
    double? JointGroupSpeedLimitDegS = null,
    double? JointGroupPositionToleranceDeg = null,
    int? JointGroupSettledDurationMs = null,
    int? JointGroupCompletionTimeoutMs = null,
    int SerialOpenTimeoutMs = 5_000,
    int JointPollIntervalMs = 25,
    int StatusPollIntervalMs = 500)
{
    public const int DefaultPort = 5127;

    public static GatewayHostOptions FromConfiguration(IConfiguration configuration, IHostEnvironment environment)
    {
        var port = int.TryParse(configuration["PORT"], out var configuredPort)
            ? configuredPort
            : DefaultPort;
        var token = configuration["SESSION_TOKEN"] ?? string.Empty;
        var tokenSource = configuration["TOKEN_SOURCE"]?.Trim().ToLowerInvariant() ?? "development";
        var origins = (configuration["DEV_ORIGINS"] ?? "http://127.0.0.1:5173;http://localhost:5173;http://127.0.0.1:5174;http://localhost:5174")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var commandPolicy = (configuration["COMMAND_POLICY"] ?? "disabled").Trim().ToLowerInvariant() switch
        {
            "disabled" => GatewayCommandPolicy.Disabled,
            "supervised" => GatewayCommandPolicy.Supervised,
            "engineering" => GatewayCommandPolicy.Engineering,
            _ => throw new InvalidOperationException("AETHOR_GATEWAY_COMMAND_POLICY must be disabled, supervised, or engineering")
        };
        double? jointGroupSpeedLimit = string.IsNullOrWhiteSpace(configuration["JOINT_GROUP_SPEED_LIMIT_DEG_S"])
            ? null
            : double.TryParse(
                configuration["JOINT_GROUP_SPEED_LIMIT_DEG_S"],
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out var configuredSpeedLimit)
                ? configuredSpeedLimit
                : throw new InvalidOperationException("AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S must be a number");
        double? jointGroupPositionTolerance = ParseOptionalDouble(
            configuration["JOINT_GROUP_POSITION_TOLERANCE_DEG"],
            "AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG");
        int? jointGroupSettledDuration = ParseOptionalInt(
            configuration["JOINT_GROUP_SETTLED_DURATION_MS"],
            "AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS");
        int? jointGroupCompletionTimeout = ParseOptionalInt(
            configuration["JOINT_GROUP_COMPLETION_TIMEOUT_MS"],
            "AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS");
        var serialOpenTimeout = ParseOptionalInt(
                configuration["SERIAL_OPEN_TIMEOUT_MS"],
                "AETHOR_GATEWAY_SERIAL_OPEN_TIMEOUT_MS")
            ?? 5_000;
        var jointPollInterval = ParseOptionalInt(
                configuration["JOINT_POLL_INTERVAL_MS"],
                "AETHOR_GATEWAY_JOINT_POLL_INTERVAL_MS")
            ?? 25;
        var statusPollInterval = ParseOptionalInt(
                configuration["STATUS_POLL_INTERVAL_MS"],
                "AETHOR_GATEWAY_STATUS_POLL_INTERVAL_MS")
            ?? 500;
        var result = new GatewayHostOptions(
            port,
            token,
            tokenSource,
            origins,
            commandPolicy,
            jointGroupSpeedLimit,
            jointGroupPositionTolerance,
            jointGroupSettledDuration,
            jointGroupCompletionTimeout,
            serialOpenTimeout,
            jointPollInterval,
            statusPollInterval);
        result.Validate(environment.IsDevelopment());
        return result;
    }

    public void Validate(bool isDevelopment)
    {
        if (Port is < 1024 or > 65535)
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_PORT must be between 1024 and 65535");
        }

        if (SerialOpenTimeoutMs is < 100 or > 30_000)
        {
            throw new InvalidOperationException(
                "AETHOR_GATEWAY_SERIAL_OPEN_TIMEOUT_MS must be between 100 and 30000");
        }

        if (JointPollIntervalMs is < 20 or > 1_000)
        {
            throw new InvalidOperationException(
                "AETHOR_GATEWAY_JOINT_POLL_INTERVAL_MS must be between 20 and 1000");
        }

        if (StatusPollIntervalMs < JointPollIntervalMs || StatusPollIntervalMs > 10_000)
        {
            throw new InvalidOperationException(
                "AETHOR_GATEWAY_STATUS_POLL_INTERVAL_MS must be at least the joint poll interval and no more than 10000");
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

        if (CommandPolicy == GatewayCommandPolicy.Supervised && TokenSource != "desktop")
        {
            throw new InvalidOperationException("Supervised hardware commands require a desktop-shell session token");
        }

        if (CommandPolicy == GatewayCommandPolicy.Engineering
            && (!isDevelopment || TokenSource != "development"))
        {
            throw new InvalidOperationException("Engineering hardware commands require Development environment and a development session token");
        }

        if (JointGroupSpeedLimitDegS is { } speedLimit
            && (!double.IsFinite(speedLimit) || speedLimit <= 0))
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S must be finite and greater than zero");
        }


        var jointGroupConfigurationCount = new object?[]
        {
            JointGroupSpeedLimitDegS,
            JointGroupPositionToleranceDeg,
            JointGroupSettledDurationMs,
            JointGroupCompletionTimeoutMs
        }.Count(value => value is not null);
        if (jointGroupConfigurationCount is not (0 or 4))
        {
            throw new InvalidOperationException("Joint-group speed, tolerance, settled duration, and completion timeout must be configured together");
        }

        if (JointGroupPositionToleranceDeg is { } tolerance
            && (!double.IsFinite(tolerance) || tolerance is < 0.01 or > 5))
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG must be between 0.01 and 5");
        }

        if (JointGroupSettledDurationMs is { } settledDuration
            && settledDuration is < 100 or > 5_000)
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS must be between 100 and 5000");
        }

        if (JointGroupCompletionTimeoutMs is { } completionTimeout
            && (completionTimeout is < 500 or > 120_000
                || JointGroupSettledDurationMs is not { } configuredSettledDuration
                || completionTimeout <= configuredSettledDuration))
        {
            throw new InvalidOperationException("AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS must be between 500 and 120000 and greater than the settled duration");
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

    private static double? ParseOptionalDouble(string? value, string name) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : double.TryParse(
                value,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out var parsed)
                ? parsed
                : throw new InvalidOperationException($"{name} must be a number");

    private static int? ParseOptionalInt(string? value, string name) =>
        string.IsNullOrWhiteSpace(value)
            ? null
            : int.TryParse(
                value,
                System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture,
                out var parsed)
                ? parsed
                : throw new InvalidOperationException($"{name} must be an integer");
}
