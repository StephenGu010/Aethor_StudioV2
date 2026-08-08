namespace AethorStudioV2.Application;

public abstract class GatewayException : Exception
{
    protected GatewayException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

public sealed class GatewayValidationException : GatewayException
{
    public GatewayValidationException(string message)
        : base(message)
    {
    }
}

public sealed class GatewayConflictException : GatewayException
{
    public GatewayConflictException(string message)
        : base(message)
    {
    }
}

public sealed class GatewayDependencyException : GatewayException
{
    public GatewayDependencyException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

public sealed class GatewayQueryTimeoutException : GatewayException
{
    public GatewayQueryTimeoutException(string query)
        : base($"Read-only query timed out: {query}")
    {
    }
}

public sealed class GatewayProtocolException : GatewayException
{
    public GatewayProtocolException(string message)
        : base(message)
    {
    }
}
