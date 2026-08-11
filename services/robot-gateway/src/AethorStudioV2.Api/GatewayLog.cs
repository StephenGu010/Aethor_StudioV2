namespace AethorStudioV2.Api;

internal static partial class GatewayLog
{
    [LoggerMessage(1000, LogLevel.Information, "Aethor Robot Gateway starting ContractVersion={ContractVersion} Port={Port} Bind=loopback TokenSource={TokenSource}")]
    public static partial void Starting(ILogger logger, string contractVersion, int port, string tokenSource);

    [LoggerMessage(1001, LogLevel.Warning, "Gateway authentication rejected {Method} {Path}")]
    public static partial void AuthenticationRejected(ILogger logger, string method, string path);

    [LoggerMessage(1002, LogLevel.Error, "serial.catalog.failed OperationId={OperationId} DurationMs={DurationMs} FailureCategory={FailureCategory}")]
    public static partial void SerialEnumerationFailed(ILogger logger, Exception exception, string operationId, long durationMs, string failureCategory);

    [LoggerMessage(1006, LogLevel.Information, "serial.catalog.started OperationId={OperationId}")]
    public static partial void SerialEnumerationStarted(ILogger logger, string operationId);

    [LoggerMessage(1007, LogLevel.Information, "serial.catalog.completed OperationId={OperationId} ResultCount={ResultCount} DurationMs={DurationMs}")]
    public static partial void SerialEnumerationCompleted(ILogger logger, string operationId, int resultCount, long durationMs);

    [LoggerMessage(1008, LogLevel.Information, "serial.session.started OperationId={OperationId} Operation={Operation}")]
    public static partial void SerialSessionStarted(ILogger logger, string operationId, string operation);

    [LoggerMessage(1009, LogLevel.Information, "serial.session.completed OperationId={OperationId} Operation={Operation} ConnectionState={ConnectionState} DurationMs={DurationMs}")]
    public static partial void SerialSessionCompleted(ILogger logger, string operationId, string operation, string connectionState, long durationMs);

    [LoggerMessage(1010, LogLevel.Warning, "serial.session.failed OperationId={OperationId} Operation={Operation} DurationMs={DurationMs} FailureCategory={FailureCategory}")]
    public static partial void SerialSessionFailed(ILogger logger, Exception? exception, string operationId, string operation, long durationMs, string failureCategory);

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
