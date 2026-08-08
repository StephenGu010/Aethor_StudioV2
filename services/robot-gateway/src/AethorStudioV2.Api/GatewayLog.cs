namespace AethorStudioV2.Api;

internal static partial class GatewayLog
{
    [LoggerMessage(1000, LogLevel.Information, "Aethor Robot Gateway starting ContractVersion={ContractVersion} Port={Port} Bind=loopback TokenSource={TokenSource}")]
    public static partial void Starting(ILogger logger, string contractVersion, int port, string tokenSource);

    [LoggerMessage(1001, LogLevel.Warning, "Gateway authentication rejected {Method} {Path}")]
    public static partial void AuthenticationRejected(ILogger logger, string method, string path);

    [LoggerMessage(1002, LogLevel.Error, "Serial port enumeration failed")]
    public static partial void SerialEnumerationFailed(ILogger logger, Exception exception);

    [LoggerMessage(1003, LogLevel.Warning, "Serial connection failed")]
    public static partial void SerialConnectionFailed(ILogger logger, Exception? exception);

    [LoggerMessage(1004, LogLevel.Warning, "Gateway shutdown deadline expired while closing the serial session")]
    public static partial void ShutdownDeadlineExpired(ILogger logger);

    [LoggerMessage(1005, LogLevel.Error, "Gateway shutdown could not close the serial session cleanly")]
    public static partial void ShutdownFailed(ILogger logger, Exception exception);

    [LoggerMessage(1100, LogLevel.Information, "{EventName} SessionId={SessionId} PortName={PortName} Detail={Detail}")]
    public static partial void DiagnosticInformation(ILogger logger, Exception? exception, string eventName, string? sessionId, string? portName, string detail);

    [LoggerMessage(1101, LogLevel.Warning, "{EventName} SessionId={SessionId} PortName={PortName} Detail={Detail}")]
    public static partial void DiagnosticWarning(ILogger logger, Exception? exception, string eventName, string? sessionId, string? portName, string detail);

    [LoggerMessage(1102, LogLevel.Error, "{EventName} SessionId={SessionId} PortName={PortName} Detail={Detail}")]
    public static partial void DiagnosticError(ILogger logger, Exception? exception, string eventName, string? sessionId, string? portName, string detail);
}
