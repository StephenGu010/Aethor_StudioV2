using AethorStudioV2.Application;

namespace AethorStudioV2.Api;

public sealed class GatewayHostedLifecycle(
    EngineeringActionProgramRuntime actionRuntime,
    RobotGateway gateway,
    ILogger<GatewayHostedLifecycle> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (actionRuntime.IsActive)
            {
                await actionRuntime.StopAsync("网关宿主正在关闭")
                    .WaitAsync(cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            GatewayLog.ShutdownDeadlineExpired(logger);
        }
        catch (Exception exception)
        {
            GatewayLog.ShutdownFailed(logger, exception);
        }

        try
        {
            await gateway.ShutdownAsync(cancellationToken).ConfigureAwait(false);
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
