using AethorStudioV2.Domain;

namespace AethorStudioV2.Api;

public static class GatewayHostShutdownPolicy
{
    public static bool CanShutdown(RobotSessionSnapshot session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return session.ConnectionState == ConnectionState.Offline
            || session.MotorState == MotorState.Disabled;
    }
}
