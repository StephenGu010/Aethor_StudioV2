using System.Security.Cryptography;
using System.Text;

namespace AethorStudioV2.Api;

public sealed class SessionTokenValidator
{
    private readonly byte[] expectedHash;

    public SessionTokenValidator(string expectedToken)
    {
        expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expectedToken));
    }

    public bool IsValid(string? candidate)
    {
        if (string.IsNullOrEmpty(candidate) || candidate.Length > 256)
        {
            return false;
        }

        var candidateHash = SHA256.HashData(Encoding.UTF8.GetBytes(candidate));
        return CryptographicOperations.FixedTimeEquals(expectedHash, candidateHash);
    }
}

public sealed class SessionTokenMiddleware(
    RequestDelegate next,
    SessionTokenValidator tokenValidator,
    ILogger<SessionTokenMiddleware> logger)
{
    public const string HeaderName = "X-Aethor-Session";

    public async Task InvokeAsync(HttpContext context)
    {
        if (!IsProtectedPath(context.Request.Path))
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        var candidate = context.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrEmpty(candidate) && context.Request.Path.StartsWithSegments("/hubs/robot-v1"))
        {
            var authorization = context.Request.Headers.Authorization.FirstOrDefault();
            if (authorization?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true)
            {
                candidate = authorization["Bearer ".Length..];
            }
        }

        if (string.IsNullOrEmpty(candidate) && context.Request.Path.StartsWithSegments("/hubs/robot-v1"))
        {
            candidate = context.Request.Query["access_token"].FirstOrDefault();
        }

        if (!tokenValidator.IsValid(candidate))
        {
            GatewayLog.AuthenticationRejected(logger, context.Request.Method, context.Request.Path.Value ?? string.Empty);
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                type = "https://aethor.local/problems/session-token",
                title = "Gateway session token is missing or invalid",
                status = StatusCodes.Status401Unauthorized
            }).ConfigureAwait(false);
            return;
        }

        await next(context).ConfigureAwait(false);
    }

    private static bool IsProtectedPath(PathString path) =>
        path.StartsWithSegments("/api/v1") || path.StartsWithSegments("/hubs/robot-v1");
}
