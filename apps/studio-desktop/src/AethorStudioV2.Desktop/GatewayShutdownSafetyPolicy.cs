namespace AethorStudioV2.Desktop;

public static class GatewayShutdownSafetyPolicy
{
    public static bool CanExitAfterGatewayTermination(
        bool gatewayProcessWasStarted,
        bool hostShutdownAccepted) =>
        !gatewayProcessWasStarted || hostShutdownAccepted;
}
