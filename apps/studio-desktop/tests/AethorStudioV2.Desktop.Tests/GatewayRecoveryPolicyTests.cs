namespace AethorStudioV2.Desktop.Tests;

public sealed class GatewayRecoveryPolicyTests
{
    [Fact]
    public void OfflineRestartIsRejectedBeforeAnUnexpectedGatewayExit()
    {
        var policy = new GatewayRecoveryPolicy();

        Assert.False(policy.TryRequestOfflineRestart());
        Assert.Equal(GatewayRecoveryState.Normal, policy.State);
    }

    [Fact]
    public void UnexpectedExitAllowsExactlyOneExplicitOfflineRestartRequest()
    {
        var policy = new GatewayRecoveryPolicy();

        Assert.True(policy.ObserveUnexpectedExit());
        Assert.Equal(GatewayRecoveryState.GatewayFailed, policy.State);
        Assert.True(policy.TryRequestOfflineRestart());
        Assert.False(policy.TryRequestOfflineRestart());
        Assert.Equal(GatewayRecoveryState.OfflineRestartRequested, policy.State);
    }

    [Fact]
    public void RepeatedExitCannotDowngradeAnOfflineRestartRequest()
    {
        var policy = new GatewayRecoveryPolicy();

        policy.ObserveUnexpectedExit();
        policy.TryRequestOfflineRestart();

        Assert.False(policy.ObserveUnexpectedExit());
        Assert.Equal(GatewayRecoveryState.OfflineRestartRequested, policy.State);
    }

    [Fact]
    public async Task ConcurrentRestartRequestsHaveOneWinner()
    {
        var policy = new GatewayRecoveryPolicy();
        policy.ObserveUnexpectedExit();

        var results = await Task.WhenAll(
            Enumerable.Range(0, 32)
                .Select(_ => Task.Run(policy.TryRequestOfflineRestart)));

        Assert.Single(results, accepted => accepted);
        Assert.Equal(GatewayRecoveryState.OfflineRestartRequested, policy.State);
    }
}
