namespace AethorStudioV2.Application;

public sealed record ReadOnlyGatewayOptions
{
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(500);
    public TimeSpan QueryTimeout { get; init; } = TimeSpan.FromSeconds(2);
    public int ConsecutiveTimeoutLimit { get; init; } = 3;
    public int ProtocolFrameCapacity { get; init; } = 256;
    public int EventQueueCapacity { get; init; } = 128;
    public int ReadBufferBytes { get; init; } = 512;

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

        if (ReadBufferBytes is < 256 or > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(ReadBufferBytes));
        }
    }
}
