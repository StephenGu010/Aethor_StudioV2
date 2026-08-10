namespace AethorStudioV2.Desktop;

public enum GatewayRecoveryState
{
    Normal = 0,
    GatewayFailed = 1,
    OfflineRestartRequested = 2
}

/// <summary>
/// Enforces the one-way desktop recovery boundary after an unexpected gateway
/// exit. Recovery never restarts the gateway; the only permitted transition is
/// an explicit request for a new offline desktop process.
/// </summary>
public sealed class GatewayRecoveryPolicy
{
    private int state = (int)GatewayRecoveryState.Normal;

    public GatewayRecoveryState State => (GatewayRecoveryState)Volatile.Read(ref state);

    public bool ObserveUnexpectedExit() =>
        Interlocked.CompareExchange(
            ref state,
            (int)GatewayRecoveryState.GatewayFailed,
            (int)GatewayRecoveryState.Normal) == (int)GatewayRecoveryState.Normal;

    public bool TryRequestOfflineRestart() =>
        Interlocked.CompareExchange(
            ref state,
            (int)GatewayRecoveryState.OfflineRestartRequested,
            (int)GatewayRecoveryState.GatewayFailed) == (int)GatewayRecoveryState.GatewayFailed;
}
