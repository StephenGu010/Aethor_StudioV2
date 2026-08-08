import {
  HubConnectionBuilder,
  LogLevel,
  type HubConnection
} from '@microsoft/signalr';
import type {
  CommandResult,
  JointGroupCommand,
  JointStateFrame,
  ProtocolFrame,
  ReadOnlyConnectRequest,
  ReadOnlyGatewayCapabilities,
  RobotSessionSnapshot,
  SerialPortDescriptor
} from '@aethor/contracts';
import { z } from 'zod';
import type {
  CloseGatewayTelemetry,
  RobotGatewayTelemetryListener,
  RobotGatewayV1
} from './robotGateway';

const dataSourceSchema = z.enum(['showcase', 'measured', 'commanded', 'computed', 'unavailable']);
const validitySchema = z.enum(['valid', 'stale', 'invalid', 'unavailable']);
const sessionSchema = z.object({
  sessionId: z.string().min(1),
  profileId: z.string().min(1),
  connectionState: z.enum(['offline', 'connecting', 'connected', 'reconnecting', 'disconnecting', 'faulted']),
  motorState: z.enum(['unknown', 'disabled', 'enabled']),
  controlMode: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  timestampUtc: z.string().min(1),
  source: dataSourceSchema,
  validity: validitySchema
}).strict();
const jointStateSchema = z.object({
  sequence: z.number().int().nonnegative(),
  profileId: z.string().min(1),
  timestampUtc: z.string().min(1),
  positionsDeg: z.array(z.number().finite()).length(6),
  source: dataSourceSchema,
  validity: validitySchema
}).strict();
const protocolFrameProperties = {
  id: z.string().min(1),
  timestampUtc: z.string().min(1),
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
const readOnlyCapabilitiesSchema = z.object({
  contractVersion: z.literal('1.0'),
  protocolAdapterId: z.literal('dummy-ascii-v1'),
  serialEnumeration: z.boolean(),
  readOnlyConnection: z.boolean(),
  liveTelemetry: z.boolean(),
  hardwareCommands: z.literal(false),
  allowedQueries: z.array(z.enum(['#GETJPOS', '#GETMODE', '#GETENABLE'])).length(3)
}).strict();

export interface HttpRobotGatewayConfig {
  baseUrl: string;
  sessionToken: string;
  requestTimeoutMs?: number;
}

export class GatewayHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GatewayHttpError';
  }
}

export class HttpRobotGateway implements RobotGatewayV1 {
  readonly capabilities = {
    source: 'readonlyGateway',
    serialEnumeration: true,
    readOnlyConnection: true,
    hardwareCommands: false,
    rawCommand: false,
    liveTelemetry: true
  } as const;

  private readonly baseUrl: string;
  private readonly sessionToken: string;
  private readonly requestTimeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(config: HttpRobotGatewayConfig, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.baseUrl = normalizeLoopbackGatewayUrl(config.baseUrl);
    if (config.sessionToken.length < 32 || config.sessionToken.length > 256) {
      throw new Error('Gateway session token must contain 32-256 characters');
    }
    this.sessionToken = config.sessionToken;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 5_000;
    if (this.requestTimeoutMs < 250 || this.requestTimeoutMs > 30_000) {
      throw new Error('Gateway request timeout must be between 250 ms and 30 s');
    }
    this.fetcher = fetcher;
  }

  async getReadOnlyCapabilities(): Promise<ReadOnlyGatewayCapabilities> {
    return this.request('/api/v1/gateway/capabilities', readOnlyCapabilitiesSchema);
  }

  async listSerialPorts(): Promise<SerialPortDescriptor[]> {
    return this.request('/api/v1/serial/ports', z.array(serialPortSchema));
  }

  async connectReadOnly(request: ReadOnlyConnectRequest): Promise<RobotSessionSnapshot> {
    return this.request('/api/v1/session/connect', sessionSchema, {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  async disconnect(): Promise<RobotSessionSnapshot> {
    return this.request('/api/v1/session/disconnect', sessionSchema, { method: 'POST' });
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

  async openTelemetry(listener: RobotGatewayTelemetryListener): Promise<CloseGatewayTelemetry> {
    const connection = this.createHubConnection();
    connection.on('sessionSnapshot', (value: unknown) => this.deliver(value, sessionSchema, listener.onSession, listener));
    connection.on('jointStateFrame', (value: unknown) => this.deliver(value, jointStateSchema, listener.onJointState, listener));
    connection.on('protocolFrame', (value: unknown) => this.deliver(value, protocolFrameSchema, listener.onProtocolFrame, listener));
    connection.onreconnecting(() => listener.onTransportError?.('实时遥测连接正在重连；REST 状态仍可手动刷新'));
    connection.onclose(() => listener.onTransportError?.('实时遥测连接已断开；当前数据可能陈旧'));
    try {
      await connection.start();
    } catch {
      await safeStop(connection);
      throw new GatewayHttpError(0, '只读网关实时连接失败');
    }

    let closed = false;
    return async () => {
      if (closed) return;
      closed = true;
      await safeStop(connection);
    };
  }

  async sendJointGroup(command: JointGroupCommand): Promise<CommandResult> {
    return unsupported(command.commandId, 'Phase 4 只读网关不提供关节下发端点');
  }

  async sendRaw(commandId: string, _raw: string): Promise<CommandResult> {
    return unsupported(commandId, 'Phase 4 只读网关不提供原始命令端点');
  }

  async emergencyStop(commandId: string): Promise<CommandResult> {
    return unsupported(commandId, 'Phase 4 尚未实现软件停止；请使用物理急停');
  }

  private createHubConnection(): HubConnection {
    return new HubConnectionBuilder()
      .withUrl(`${this.baseUrl}/hubs/robot-v1`, {
        accessTokenFactory: () => this.sessionToken
      })
      .withAutomaticReconnect([0, 1_000, 3_000])
      .configureLogging(LogLevel.Warning)
      .build();
  }

  private deliver<T>(
    value: unknown,
    schema: z.ZodType<T>,
    receiver: ((parsed: T) => void) | undefined,
    listener: RobotGatewayTelemetryListener
  ) {
    const result = schema.safeParse(value);
    if (!result.success) {
      listener.onTransportError?.('网关返回了不符合 V1 契约的遥测数据');
      return;
    }
    receiver?.(result.data);
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.requestTimeoutMs);
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
          : `只读网关请求失败（HTTP ${response.status}）`);
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw new GatewayHttpError(502, '网关响应不符合 RobotGatewayV1 契约');
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof GatewayHttpError) throw error;
      if (controller.signal.aborted) throw new GatewayHttpError(408, '只读网关请求超时');
      throw new GatewayHttpError(0, '无法访问本机只读网关');
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
    // The caller is already closing a failed telemetry transport; REST remains authoritative.
  }
}

function unsupported(commandId: string, message: string): CommandResult {
  return { commandId, status: 'unsupported', message, timestampUtc: new Date().toISOString() };
}
