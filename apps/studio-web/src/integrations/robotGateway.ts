import type {
  ActionProgramRunSnapshotV1,
  ActionProgramRunStartRequestV1,
  CommandResult,
  CommandAuditRecord,
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

export interface RobotGatewayCapabilities {
  source: 'showcase' | 'gateway';
  serialEnumeration: boolean;
  readOnlyConnection: boolean;
  hardwareCommands: boolean;
  rawCommand: boolean;
  liveTelemetry: boolean;
  commandPolicy: 'disabled' | 'supervised' | 'engineering';
  supportedCommands: RobotGatewayCapabilitiesV1['supportedCommands'];
  jointGroupSpeedLimitDegS: number | null;
  jointGroupCompletion: RobotGatewayCapabilitiesV1['jointGroupCompletion'];
  engineeringJointSpeedMaxDegS: number | null;
}

export interface RobotGatewayTransportIncident {
  kind: 'reconnecting' | 'closed' | 'contractViolation';
  message: string;
}

export interface RobotGatewayTelemetryListener {
  onSession?: (snapshot: RobotSessionSnapshot) => void;
  onJointState?: (frame: JointStateFrame) => void;
  onProtocolFrame?: (frame: ProtocolFrame) => void;
  onCommandResult?: (result: CommandResult) => void;
  onDirectCommandResult?: (result: DirectCommandResult) => void;
  onActionProgramRun?: (snapshot: ActionProgramRunSnapshotV1) => void;
  onTransportError?: (incident: RobotGatewayTransportIncident) => void;
  onTransportRecovered?: () => void;
}

export type CloseGatewayTelemetry = () => Promise<void>;

export interface RobotGatewayV1 {
  readonly capabilities: RobotGatewayCapabilities;
  readonly unavailableReason?: string;
  getCapabilities(): Promise<RobotGatewayCapabilitiesV1 | null>;
  listSerialPorts(operationId?: string): Promise<SerialPortDescriptor[]>;
  connect(request: RobotConnectRequest, operationId?: string): Promise<RobotSessionSnapshot>;
  disconnect(operationId?: string): Promise<RobotSessionSnapshot>;
  openTelemetry(listener: RobotGatewayTelemetryListener): Promise<CloseGatewayTelemetry>;
  getSession(): Promise<RobotSessionSnapshot>;
  getJointState(): Promise<JointStateFrame>;
  getProtocolFrames(): Promise<ProtocolFrame[]>;
  getCommandHistory(): Promise<CommandAuditRecord[]>;
  getDirectCommandHistory(): Promise<DirectCommandResult[]>;
  getActionProgramRun(): Promise<ActionProgramRunSnapshotV1 | null>;
  enable(command: SimpleRobotCommand): Promise<CommandResult>;
  stopAndDisable(command: SimpleRobotCommand): Promise<CommandResult>;
  home(command: SimpleRobotCommand): Promise<CommandResult>;
  reset(command: SimpleRobotCommand): Promise<CommandResult>;
  setMode(command: SetModeCommand): Promise<CommandResult>;
  sendJointGroup(command: JointGroupCommand): Promise<CommandResult>;
  sendDirectCommand(command: DirectCommandRequest): Promise<DirectCommandResult>;
  startActionProgram(request: ActionProgramRunStartRequestV1): Promise<ActionProgramRunSnapshotV1>;
  stopActionProgram(): Promise<ActionProgramRunSnapshotV1>;
}
