namespace AethorStudioV2.Desktop.Tests;

public sealed class GatewayShutdownSafetyPolicyTests
{
    [Theory]
    [InlineData(false, false, true)]
    [InlineData(false, true, true)]
    [InlineData(true, true, true)]
    [InlineData(true, false, false)]
    public void ExitRequiresHostConfirmationAfterAStartedGatewayTerminates(
        bool gatewayProcessWasStarted,
        bool hostShutdownAccepted,
        bool expected)
    {
        Assert.Equal(
            expected,
            GatewayShutdownSafetyPolicy.CanExitAfterGatewayTermination(
                gatewayProcessWasStarted,
                hostShutdownAccepted));
    }
}
