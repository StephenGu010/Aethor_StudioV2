using AethorStudioV2.Application;

namespace AethorStudioV2.Api;

public static class ActionProgramRunEndpoints
{
    public static async Task<IResult> StopAsync(
        EngineeringActionProgramRuntime runtime,
        CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = await runtime.StopAsync("操作员按下停止")
                .WaitAsync(cancellationToken)
                .ConfigureAwait(false);
            return Results.Ok(snapshot);
        }
        catch (GatewayConflictException exception)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Action program stop rejected",
                detail: exception.Message,
                type: "https://aethor.local/problems/gateway-operation");
        }
    }
}
