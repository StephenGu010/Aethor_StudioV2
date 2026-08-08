using AethorStudioV2.Application;

namespace AethorStudioV2.Api;

public sealed class GatewayHostedLifecycle(
    ReadOnlyRobotGateway gateway,
    ILogger<GatewayHostedLifecycle> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await gateway.DisconnectAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            GatewayLog.ShutdownDeadlineExpired(logger);
        }
        catch (Exception exception)
        {
            GatewayLog.ShutdownFailed(logger, exception);
        }
    }
}
