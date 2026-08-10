using AethorStudioV2.Domain;

namespace AethorStudioV2.Application;

public sealed record RobotGatewayOptions
{
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(500);
    public TimeSpan QueryTimeout { get; init; } = TimeSpan.FromSeconds(2);
    public int ConsecutiveTimeoutLimit { get; init; } = 3;
    public int ProtocolFrameCapacity { get; init; } = 256;
    public int EventQueueCapacity { get; init; } = 128;
    public TimeSpan EventPublishTimeout { get; init; } = TimeSpan.FromSeconds(2);
    public TimeSpan EventShutdownDrainTimeout { get; init; } = TimeSpan.FromSeconds(2);
    public int ReadBufferBytes { get; init; } = 512;
    public bool HardwareCommandsEnabled { get; init; }
    public bool EngineeringCommandsEnabled { get; init; }
    public double EngineeringJointSpeedMaxDegS { get; init; } = 100;
    public double? JointGroupSpeedLimitDegS { get; init; }
    public JointGroupCompletionPolicy? JointGroupCompletion { get; init; }
    public TimeSpan CommandTimeout { get; init; } = TimeSpan.FromSeconds(3);
    public int CommandHistoryCapacity { get; init; } = 128;

    public void Validate()
    {
        if (PollInterval < TimeSpan.FromMilliseconds(50) || PollInterval > TimeSpan.FromSeconds(10))
        {
            throw new ArgumentOutOfRangeException(nameof(PollInterval), "Poll interval must be between 50 ms and 10 s");
        }

        if (QueryTimeout < TimeSpan.FromMilliseconds(50) || QueryTimeout > TimeSpan.FromSeconds(30))
        {
            throw new ArgumentOutOfRangeException(nameof(QueryTimeout), "Query timeout must be between 50 ms and 30 s");
        }

        if (ConsecutiveTimeoutLimit is < 1 or > 10)
        {
            throw new ArgumentOutOfRangeException(nameof(ConsecutiveTimeoutLimit));
        }

        if (ProtocolFrameCapacity is < 32 or > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(ProtocolFrameCapacity));
        }

        if (EventQueueCapacity is < 16 or > 1024)
        {
            throw new ArgumentOutOfRangeException(nameof(EventQueueCapacity));
        }

        if (EventPublishTimeout < TimeSpan.FromMilliseconds(100)
            || EventPublishTimeout > TimeSpan.FromSeconds(30))
        {
            throw new ArgumentOutOfRangeException(
                nameof(EventPublishTimeout),
                "Event publish timeout must be between 100 ms and 30 s");
        }

        if (EventShutdownDrainTimeout < TimeSpan.FromMilliseconds(100)
            || EventShutdownDrainTimeout > TimeSpan.FromSeconds(30))
        {
            throw new ArgumentOutOfRangeException(
                nameof(EventShutdownDrainTimeout),
                "Event shutdown drain timeout must be between 100 ms and 30 s");
        }

        if (ReadBufferBytes is < 256 or > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(ReadBufferBytes));
        }

        if (CommandTimeout < TimeSpan.FromMilliseconds(100) || CommandTimeout > TimeSpan.FromSeconds(30))
        {
            throw new ArgumentOutOfRangeException(nameof(CommandTimeout), "Command timeout must be between 100 ms and 30 s");
        }

        if (CommandHistoryCapacity is < 16 or > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(CommandHistoryCapacity));
        }

        if (EngineeringCommandsEnabled && !HardwareCommandsEnabled)
        {
            throw new ArgumentException("Engineering commands require hardware commands to be enabled");
        }

        if (!double.IsFinite(EngineeringJointSpeedMaxDegS)
            || EngineeringJointSpeedMaxDegS <= 0
            || EngineeringJointSpeedMaxDegS > 100)
        {
            throw new ArgumentOutOfRangeException(
                nameof(EngineeringJointSpeedMaxDegS),
                "Engineering joint speed must be within the Dummy firmware input range 0-100 deg/s");
        }

        if (JointGroupSpeedLimitDegS is { } speedLimit
            && (!double.IsFinite(speedLimit) || speedLimit <= 0))
        {
            throw new ArgumentOutOfRangeException(nameof(JointGroupSpeedLimitDegS), "Joint-group speed limit must be finite and greater than zero");
        }

        if ((JointGroupSpeedLimitDegS is null) != (JointGroupCompletion is null))
        {
            throw new ArgumentException("Joint-group speed and completion policy must be configured together");
        }

        if (JointGroupCompletion is { } completion
            && (!double.IsFinite(completion.PositionToleranceDeg)
                || completion.PositionToleranceDeg is < 0.01 or > 5
                || completion.SettledDurationMs is < 100 or > 5_000
                || completion.TimeoutMs is < 500 or > 120_000
                || completion.TimeoutMs <= completion.SettledDurationMs))
        {
            throw new ArgumentOutOfRangeException(
                nameof(JointGroupCompletion),
                "Joint-group completion requires 0.01-5 deg tolerance, 100-5000 ms settled duration, and a 500-120000 ms timeout greater than the settled duration");
        }
    }
}
