using AethorStudioV2.Api;
using AethorStudioV2.Domain;

namespace AethorStudioV2.Tests;

public sealed class GatewayHostShutdownPolicyTests
{
    [Theory]
    [InlineData(ConnectionState.Offline, MotorState.Unknown, true)]
    [InlineData(ConnectionState.Offline, MotorState.Enabled, true)]
    [InlineData(ConnectionState.Connected, MotorState.Disabled, true)]
    [InlineData(ConnectionState.Connected, MotorState.Unknown, false)]
    [InlineData(ConnectionState.Connected, MotorState.Enabled, false)]
    [InlineData(ConnectionState.Faulted, MotorState.Unknown, false)]
    public void CanShutdownRequiresNoSerialSessionOrConfirmedDisabledMotor(
        ConnectionState connectionState,
        MotorState motorState,
        bool expected)
    {
        var session = new RobotSessionSnapshot(
            "session-1",
            GatewayContractV1.DummyProfileId,
            connectionState,
            motorState,
            null,
            DateTimeOffset.UnixEpoch,
            DataSource.Unavailable,
            Validity.Unavailable);

        Assert.Equal(expected, GatewayHostShutdownPolicy.CanShutdown(session));
    }
}
