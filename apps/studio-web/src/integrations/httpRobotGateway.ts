import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr';
import type {
  CommandAuditRecord,
  CommandResult,
  DirectCommandRequest,
  DirectCommandResult,
  JointGroupCommand,
  JointStateFrame,
  ProtocolFrame,
  RobotConnectRequest,
  RobotGatewayCapabilitiesV1,
  RobotSessionSnapshot,
  SerialPortDescriptor,
  SetModeCommand,
  SimpleRobotCommand
} from '@aethor/contracts';
import { z } from 'zod';
import type {
  CloseGatewayTelemetry,
  RobotGatewayCapabilities,
  RobotGatewayTelemetryListener,
  RobotGatewayV1
} from './robotGateway';

const dataSourceSchema = z.enum(['showcase', 'measured', 'commanded', 'computed', 'unavailable']);
const validitySchema = z.enum(['valid', 'stale', 'invalid', 'unavailable']);
const utcTimestampSchema = z.string().refine(
  (value) => /(?:Z|\+00:00)$/i.test(value) && Number.isFinite(Date.parse(value)),
  'Expected a UTC ISO 8601 timestamp'
);
const sessionSchema = z.object({
  sessionId: z.string().min(1),
  profileId: z.string().min(1),
  connectionState: z.enum(['offline', 'connecting', 'connected', 'reconnecting', 'disconnecting', 'faulted']),
  motorState: z.enum(['unknown', 'disabled', 'enabled']),
  controlMode: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  timestampUtc: utcTimestampSchema,
  source: dataSourceSchema,
  validity: validitySchema
}).strict();
const jointStateSchema = z.object({
  sequence: z.number().int().nonnegative(),
  profileId: z.string().min(1),
  timestampUtc: utcTimestampSchema,
  positionsDeg: z.array(z.number().finite()).length(6),
  source: dataSourceSchema,
  validity: validitySchema
}).strict();
const protocolFrameProperties = {
  id: z.string().min(1),
  timestampUtc: utcTimestampSchema,
  direction: z.enum(['tx', 'rx', 'error']),
  raw: z.string().max(4096),
  parsedKind: z.string().min(1),
  source: dataSourceSchema
};
const protocolFrameSchema = z.union([
  z.object(protocolFrameProperties).strict(),
  z.object({ ...protocolFrameProperties, correlationId: z.string() }).strict()
]);
const serialPortSchema = z.object({
  portName: z.string().regex(/^COM[1-9][0-9]{0,3}$/),
  hardwareId: z.string().max(512).nullable(),
  displayName: z.string().max(256).nullable()
}).strict();
const commandKindSchema = z.enum(['enable', 'stopAndDisable', 'home', 'reset', 'setMode', 'jointGroup']);
const jointGroupCompletionSchema = z.object({
  positionToleranceDeg: z.number().finite().min(0.01).max(5),
  settledDurationMs: z.number().int().min(100).max(5_000),
  timeoutMs: z.number().int().min(500).max(120_000)
}).strict().superRefine((value, context) => {
  if (value.timeoutMs <= value.settledDurationMs) {
    context.addIssue({ code: 'custom', message: 'Joint-group completion timeout must exceed settled duration' });
  }
});
const capabilitiesSchema = z.object({
  contractVersion: z.literal('1.4'),
  protocolAdapterId: z.literal('dummy-ascii-v1'),
  serialEnumeration: z.boolean(),
  readOnlyConnection: z.boolean(),
  liveTelemetry: z.boolean(),
  hardwareCommands: z.boolean(),
  directCommand: z.boolean(),
  commandPolicy: z.enum(['disabled', 'supervised', 'engineering']),
  allowedQueries: z.array(z.enum(['#GETJPOS', '#GETMODE', '#GETENABLE'])).length(3),
  supportedCommands: z.array(commandKindSchema),
  jointGroupSpeedLimitDegS: z.number().finite().positive().nullable(),
  jointGroupCompletion: jointGroupCompletionSchema.nullable(),
  engineeringJointSpeedMaxDegS: z.number().finite().positive().max(100).nullable()
}).strict().superRefine((value, context) => {
  const uniqueQueries = new Set(value.allowedQueries);
  const uniqueCommands = new Set(value.supportedCommands);
  if (uniqueQueries.size !== value.allowedQueries.length || uniqueCommands.size !== value.supportedCommands.length) {
    context.addIssue({ code: 'custom', message: 'Gateway capability lists must be unique' });
  }
  if (value.commandPolicy === 'disabled' && (value.hardwareCommands || value.supportedCommands.length > 0)) {
    context.addIssue({ code: 'custom', message: 'Disabled command policy cannot advertise hardware commands' });
  }
  if (value.commandPolicy === 'supervised' && !value.hardwareCommands) {
    context.addIssue({ code: 'custom', message: 'Supervised command policy must advertise hardware commands' });
  }
  if (value.commandPolicy === 'supervised' && (value.directCommand || value.engineeringJointSpeedMaxDegS !== null)) {
    context.addIssue({ code: 'custom', message: 'Supervised command policy cannot advertise engineering direct commands' });
  }
  if (value.commandPolicy === 'engineering'
    && (!value.hardwareCommands || !value.directCommand || value.engineeringJointSpeedMaxDegS === null)) {
    context.addIssue({ code: 'custom', message: 'Engineering command policy requires direct commands and a firmware input speed ceiling' });
  }
  if (value.commandPolicy === 'disabled' && (value.directCommand || value.engineeringJointSpeedMaxDegS !== null)) {
    context.addIssue({ code: 'custom', message: 'Disabled command policy cannot advertise engineering direct commands' });
  }
  if ((value.jointGroupSpeedLimitDegS === null) !== (value.jointGroupCompletion === null)) {
    context.addIssue({ code: 'custom', message: 'Joint-group speed and completion policy must be configured together' });
  }
  if (value.supportedCommands.includes('jointGroup')
    && (value.jointGroupSpeedLimitDegS === null || value.jointGroupCompletion === null)) {
    context.addIssue({ code: 'custom', message: 'Joint-group capability requires a complete verified execution envelope' });
  }
});
const commandResultSchema = z.object({
  commandId: z.string().min(1),
  sessionId: z.string().min(1),
  commandKind: commandKindSchema,
  status: z.enum(['unsupported', 'rejected', 'accepted', 'completed', 'failed', 'timedOut', 'cancelled', 'unconfirmed']),
  code: z.enum(['ok', 'commandsDisabled', 'invalidRequest', 'sessionMismatch', 'notConnected', 'feedbackStale', 'motorNotEnabled', 'invalidTarget', 'speedUnverified', 'speedOutOfRange', 'safetyInterlockLatched', 'commandInFlight', 'commandIdConflict', 'deviceRejected', 'deviceUnconfirmed', 'transportError', 'timeout', 'cancelled']),
  evidence: z.enum(['none', 'gatewayAccepted', 'transportWritten', 'deviceQueued', 'deviceAck', 'feedbackConfirmed']),
  message: z.string().max(500),
  timestampUtc: utcTimestampSchema,
  deviceReply: z.string().max(4096).nullable().optional()
}).strict();
const directCommandResultSchema = z.object({
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  status: z.enum(['queued', 'sent', 'rejected', 'expired', 'superseded', 'cancelled', 'failed']),
  evidence: z.enum(['none', 'gatewayAccepted', 'transportWritten', 'deviceQueued', 'deviceAck', 'feedbackConfirmed']),
  normalizedLine: z.string().max(255),
  message: z.string().max(500),
  timestampUtc: utcTimestampSchema,
  deviceReply: z.string().max(4096).nullable().optional()
}).strict().superRefine((value, context) => {
  if (value.status === 'queued' && value.evidence !== 'gatewayAccepted') {
    context.addIssue({ code: 'custom', message: 'Queued direct results require gatewayAccepted evidence' });
  }
  if (value.status === 'queued' && value.deviceReply != null) {
    context.addIssue({ code: 'custom', message: 'A queued direct result cannot include an unverified device reply' });
  }
  if ((value.status === 'sent') !== (value.evidence === 'transportWritten')) {
    context.addIssue({ code: 'custom', message: 'Only sent direct results may use transportWritten evidence' });
  }
  if (value.status === 'sent' && value.deviceReply != null) {
    context.addIssue({ code: 'custom', message: 'A sent direct result cannot include an unverified device reply' });
  }
});
const commandRequestSnapshotSchema = z.object({
  commandKind: commandKindSchema,
  requestFingerprintSha256: z.string().regex(/^[0-9A-Fa-f]{64}$/),
  mode: z.number().int().nullable(),
  positionsDeg: z.array(z.number().finite()).max(6).nullable(),
  positionsCount: z.number().int().nonnegative().nullable(),
  speedDegS: z.number().finite().nullable(),
  payloadTruncated: z.boolean()
}).strict().superRefine((value, context) => {
  if (['enable', 'stopAndDisable', 'home', 'reset'].includes(value.commandKind)) {
    if (value.mode !== null || value.positionsDeg !== null || value.positionsCount !== null
      || value.speedDegS !== null || value.payloadTruncated) {
      context.addIssue({ code: 'custom', message: 'Simple command audit snapshots cannot contain a payload' });
    }
    return;
  }
  if (value.commandKind === 'setMode') {
    if (value.mode === null || value.positionsDeg !== null || value.positionsCount !== null
      || value.speedDegS !== null || value.payloadTruncated) {
      context.addIssue({ code: 'custom', message: 'Mode audit snapshot shape is inconsistent' });
    }
    return;
  }
  if (value.mode !== null || (value.positionsDeg === null) !== (value.positionsCount === null)) {
    context.addIssue({ code: 'custom', message: 'Joint-group audit snapshot shape is inconsistent' });
    return;
  }
  if (value.positionsDeg !== null && value.positionsCount !== null) {
    const expectedStoredCount = Math.min(value.positionsCount, 6);
    if (value.positionsDeg.length !== expectedStoredCount
      || value.payloadTruncated !== (value.positionsCount > 6)) {
      context.addIssue({ code: 'custom', message: 'Joint-group audit snapshot truncation metadata is inconsistent' });
    }
  }
});
const commandAuditSchema = z.object({
  commandId: z.string().min(1),
  sessionId: z.string().min(1),
  profileId: z.literal('dummy-6dof'),
  commandKind: commandKindSchema,
  acceptedAtUtc: utcTimestampSchema,
  request: commandRequestSnapshotSchema,
  transmittedPayloads: z.array(z.string().min(1).max(255)).max(32),
  transmissionLogTruncated: z.boolean(),
  result: commandResultSchema
}).strict().superRefine((value, context) => {
  if (value.commandKind !== value.request.commandKind || value.commandKind !== value.result.commandKind
    || value.commandId !== value.result.commandId || value.sessionId !== value.result.sessionId) {
    context.addIssue({ code: 'custom', message: 'Command audit identity fields are inconsistent' });
  }
});

export interface HttpRobotGatewayConfig {
  baseUrl: string;
  sessionToken: string;
  requestTimeoutMs?: number;
}

export type HubConnectionFactory = () => HubConnection;

export class GatewayHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GatewayHttpError';
  }
}

export class HttpRobotGateway implements RobotGatewayV1 {
  readonly capabilities: RobotGatewayCapabilities = {
    source: 'gateway',
    serialEnumeration: true,
    readOnlyConnection: true,
    hardwareCommands: false,
    rawCommand: false,
    liveTelemetry: true,
    commandPolicy: 'disabled',
    supportedCommands: [],
    jointGroupSpeedLimitDegS: null,
    jointGroupCompletion: null,
    engineeringJointSpeedMaxDegS: null
  };

  private readonly baseUrl: string;
  private readonly sessionToken: string;
  private readonly requestTimeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly hubConnectionFactory: HubConnectionFactory;

  constructor(
    config: HttpRobotGatewayConfig,
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    hubConnectionFactory?: HubConnectionFactory
  ) {
    this.baseUrl = normalizeLoopbackGatewayUrl(config.baseUrl);
    if (config.sessionToken.length < 32 || config.sessionToken.length > 256
      || [...config.sessionToken].some((character) => character < '!' || character > '~')) {
      throw new Error('Gateway session token must contain 32-256 printable ASCII characters');
    }
    this.sessionToken = config.sessionToken;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 5_000;
    if (this.requestTimeoutMs < 250 || this.requestTimeoutMs > 30_000) {
      throw new Error('Gateway request timeout must be between 250 ms and 30 s');
    }
    this.fetcher = fetcher;
    this.hubConnectionFactory = hubConnectionFactory ?? (() => new HubConnectionBuilder()
      .withUrl(`${this.baseUrl}/hubs/robot-v1`, { accessTokenFactory: () => this.sessionToken })
      .withAutomaticReconnect([0, 1_000, 3_000])
      .configureLogging(LogLevel.Warning)
      .build());
  }

  async getCapabilities(): Promise<RobotGatewayCapabilitiesV1> {
    const negotiated = await this.request('/api/v1/gateway/capabilities', capabilitiesSchema);
    this.capabilities.hardwareCommands = negotiated.hardwareCommands;
    this.capabilities.rawCommand = negotiated.directCommand;
    this.capabilities.commandPolicy = negotiated.commandPolicy;
    this.capabilities.supportedCommands = negotiated.supportedCommands;
    this.capabilities.jointGroupSpeedLimitDegS = negotiated.jointGroupSpeedLimitDegS;
    this.capabilities.jointGroupCompletion = negotiated.jointGroupCompletion;
    this.capabilities.engineeringJointSpeedMaxDegS = negotiated.engineeringJointSpeedMaxDegS;
    return negotiated;
  }

  async listSerialPorts(operationId = crypto.randomUUID()): Promise<SerialPortDescriptor[]> {
    return this.request('/api/v1/serial/ports', z.array(serialPortSchema), {
      headers: { 'X-Aethor-Operation': operationId }
    });
  }

  async connect(request: RobotConnectRequest, operationId = crypto.randomUUID()): Promise<RobotSessionSnapshot> {
    return this.request('/api/v1/session/connect', sessionSchema, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'X-Aethor-Operation': operationId }
    });
  }

  async disconnect(operationId = crypto.randomUUID()): Promise<RobotSessionSnapshot> {
    return this.request('/api/v1/session/disconnect', sessionSchema, {
      method: 'POST',
      headers: { 'X-Aethor-Operation': operationId }
    });
  }

  async getSession(): Promise<RobotSessionSnapshot> {
    return this.request('/api/v1/session', sessionSchema);
  }

  async getJointState(): Promise<JointStateFrame> {
    return this.request('/api/v1/joint-state', jointStateSchema);
  }

  async getProtocolFrames(): Promise<ProtocolFrame[]> {
    return this.request('/api/v1/protocol-frames?limit=100', z.array(protocolFrameSchema));
  }

  async getCommandHistory(): Promise<CommandAuditRecord[]> {
    return this.request('/api/v1/commands?limit=50', z.array(commandAuditSchema));
  }

  async getDirectCommandHistory(): Promise<DirectCommandResult[]> {
    return this.request('/api/v1/engineering/direct-commands?limit=50', z.array(directCommandResultSchema));
  }

  async openTelemetry(listener: RobotGatewayTelemetryListener): Promise<CloseGatewayTelemetry> {
    const connection = this.createHubConnection();
    connection.on('sessionSnapshot', (value: unknown) => this.deliver(value, sessionSchema, listener.onSession, listener));
    connection.on('jointStateFrame', (value: unknown) => this.deliver(value, jointStateSchema, listener.onJointState, listener));
    connection.on('protocolFrame', (value: unknown) => this.deliver(value, protocolFrameSchema, listener.onProtocolFrame, listener));
    connection.on('commandResult', (value: unknown) => this.deliver(value, commandResultSchema, listener.onCommandResult, listener));
    connection.on('directCommandResult', (value: unknown) => this.deliver(value, directCommandResultSchema, listener.onDirectCommandResult, listener));
    connection.onreconnecting(() => listener.onTransportError?.({
      kind: 'reconnecting',
      message: '实时遥测正在重连；等待通道恢复后核对 REST 权威快照'
    }));
    connection.onreconnected(() => listener.onTransportRecovered?.());
    connection.onclose(() => listener.onTransportError?.({
      kind: 'closed',
      message: '实时遥测已断开；当前数据可能陈旧'
    }));
    try {
      await connection.start();
    } catch {
      await safeStop(connection);
      throw new GatewayHttpError(0, '网关实时连接失败');
    }

    let closed = false;
    return async () => {
      if (closed) return;
      closed = true;
      await safeStop(connection);
    };
  }

  async enable(command: SimpleRobotCommand): Promise<CommandResult> {
    return this.postCommand('/api/v1/commands/enable', command);
  }

  async stopAndDisable(command: SimpleRobotCommand): Promise<CommandResult> {
    return this.postCommand('/api/v1/commands/stop-and-disable', command);
  }

  async home(command: SimpleRobotCommand): Promise<CommandResult> {
    return this.postCommand('/api/v1/commands/home', command);
  }

  async reset(command: SimpleRobotCommand): Promise<CommandResult> {
    return this.postCommand('/api/v1/commands/reset', command);
  }

  async setMode(command: SetModeCommand): Promise<CommandResult> {
    return this.postCommand('/api/v1/commands/set-mode', command);
  }

  async sendJointGroup(command: JointGroupCommand): Promise<CommandResult> {
    return this.postCommand('/api/v1/commands/joint-group', command);
  }

  async sendDirectCommand(command: DirectCommandRequest): Promise<DirectCommandResult> {
    return this.request('/api/v1/engineering/direct-command', directCommandResultSchema, {
      method: 'POST',
      body: JSON.stringify(command)
    });
  }

  private postCommand(path: string, command: SimpleRobotCommand | SetModeCommand | JointGroupCommand) {
    return this.request(path, commandResultSchema, { method: 'POST', body: JSON.stringify(command) });
  }

  private createHubConnection(): HubConnection {
    return this.hubConnectionFactory();
  }

  private deliver<T>(
    value: unknown,
    schema: z.ZodType<T>,
    receiver: ((parsed: T) => void) | undefined,
    listener: RobotGatewayTelemetryListener
  ) {
    const result = schema.safeParse(value);
    if (!result.success) {
      listener.onTransportError?.({
        kind: 'contractViolation',
        message: '网关返回了不符合 RobotGatewayV1 契约的数据'
      });
      return;
    }
    receiver?.(result.data);
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Aethor-Session': this.sessionToken,
          ...init.headers
        }
      });
      if (!response.ok) {
        throw new GatewayHttpError(response.status, response.status === 401
          ? '网关会话令牌无效或已过期'
          : `网关请求失败（HTTP ${response.status}）`);
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw new GatewayHttpError(502, '网关响应不符合 RobotGatewayV1 契约');
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof GatewayHttpError) throw error;
      if (controller.signal.aborted) throw new GatewayHttpError(408, '网关请求超时');
      throw new GatewayHttpError(0, '无法访问本机机器人网关');
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export function normalizeLoopbackGatewayUrl(input: string) {
  const url = new URL(input);
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (!isLoopback || !['http:', 'https:'].includes(url.protocol) || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Gateway URL must be a loopback HTTP(S) origin');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Gateway URL cannot contain credentials, query, or fragment');
  }
  return url.origin;
}

async function safeStop(connection: HubConnection) {
  try {
    await connection.stop();
  } catch {
    // The transport is already closing; REST snapshots remain authoritative.
  }
}
