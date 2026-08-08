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

export interface RobotGatewayCapabilities {
  source: 'showcase' | 'readonlyGateway';
  serialEnumeration: boolean;
  readOnlyConnection: boolean;
  hardwareCommands: boolean;
  rawCommand: boolean;
  liveTelemetry: boolean;
}

export interface RobotGatewayTelemetryListener {
  onSession?: (snapshot: RobotSessionSnapshot) => void;
  onJointState?: (frame: JointStateFrame) => void;
  onProtocolFrame?: (frame: ProtocolFrame) => void;
  onTransportError?: (message: string) => void;
}

export type CloseGatewayTelemetry = () => Promise<void>;

export interface RobotGatewayV1 {
  readonly capabilities: RobotGatewayCapabilities;
  readonly unavailableReason?: string;
  getReadOnlyCapabilities(): Promise<ReadOnlyGatewayCapabilities | null>;
  listSerialPorts(): Promise<SerialPortDescriptor[]>;
  connectReadOnly(request: ReadOnlyConnectRequest): Promise<RobotSessionSnapshot>;
  disconnect(): Promise<RobotSessionSnapshot>;
  openTelemetry(listener: RobotGatewayTelemetryListener): Promise<CloseGatewayTelemetry>;
  getSession(): Promise<RobotSessionSnapshot>;
  getJointState(): Promise<JointStateFrame>;
  getProtocolFrames(): Promise<ProtocolFrame[]>;
  sendJointGroup(command: JointGroupCommand): Promise<CommandResult>;
  sendRaw(commandId: string, raw: string): Promise<CommandResult>;
  emergencyStop(commandId: string): Promise<CommandResult>;
}
