export type DataSource = 'showcase' | 'measured' | 'commanded' | 'computed' | 'unavailable';
export type Validity = 'valid' | 'stale' | 'invalid' | 'unavailable';
export type ConnectionState =
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'faulted';
export type MotorState = 'unknown' | 'disabled' | 'enabled';
export type DummyControlMode = 1 | 2 | 3;
export type CommandStatus =
  | 'unsupported'
  | 'rejected'
  | 'accepted'
  | 'completed'
  | 'failed'
  | 'timedOut'
  | 'cancelled'
  | 'unconfirmed';
export type GatewayCommandPolicy = 'disabled' | 'supervised' | 'engineering';
export type RobotCommandKind = 'enable' | 'stopAndDisable' | 'home' | 'reset' | 'setMode' | 'jointGroup';
export type CommandEvidence = 'none' | 'gatewayAccepted' | 'transportWritten' | 'deviceQueued' | 'deviceAck' | 'feedbackConfirmed';
export type CommandResultCode =
  | 'ok'
  | 'commandsDisabled'
  | 'invalidRequest'
  | 'sessionMismatch'
  | 'notConnected'
  | 'feedbackStale'
  | 'motorNotEnabled'
  | 'invalidTarget'
  | 'speedUnverified'
  | 'speedOutOfRange'
  | 'safetyInterlockLatched'
  | 'commandInFlight'
  | 'commandIdConflict'
  | 'deviceRejected'
  | 'deviceUnconfirmed'
  | 'transportError'
  | 'timeout'
  | 'cancelled';

export interface RobotJointProfile {
  jointId: string;
  displayName: string;
  urdfJointName: string;
  protocolIndex: number;
  /** Limits in the device/protocol coordinate reported by #GETJPOS. */
  lowerDeg: number;
  upperDeg: number;
  /** modelDeg = deviceDeg * sign + offsetDeg. Omitted means identity. */
  modelTransform?: {
    sign: 1 | -1;
    offsetDeg: number;
  };
}

export interface RobotJointGroupV1 {
  groupId: string;
  displayName: string;
  jointIds: string[];
  tcpLinkName?: string;
}

export interface RobotProfileCapabilitiesV1 {
  jointPositionFeedback: boolean;
  jointGroupCommand: boolean;
  enable: boolean;
  stop: boolean;
  disable: boolean;
  home: boolean;
  reset: boolean;
  controlModes: DummyControlMode[];
  rawTerminal: boolean;
}

export interface RobotProfileManifestV1 {
  schemaVersion: '1.0';
  profileId: string;
  displayName: string;
  description?: string;
  protocolAdapterId: string;
  transportDefaults?: {
    baudRate: number;
    lineEnding: 'LF' | 'CRLF';
  };
  model: {
    dof: number;
    urdfPath: string;
    upAxis: 'X' | 'Y' | 'Z';
    lengthUnit: 'm';
    showcasePoseDeg?: number[];
  };
  joints: RobotJointProfile[];
  jointGroups?: RobotJointGroupV1[];
  capabilities: RobotProfileCapabilitiesV1;
  source: {
    urdfSha256: string;
    license: string;
    protocolReference: string;
  };
}

export interface RobotSessionSnapshot {
  sessionId: string;
  profileId: string;
  connectionState: ConnectionState;
  motorState: MotorState;
  controlMode: DummyControlMode | null;
  timestampUtc: string;
  source: DataSource;
  validity: Validity;
}

export interface SerialPortDescriptor {
  portName: string;
  hardwareId: string | null;
  displayName: string | null;
}

export interface RobotConnectRequest {
  portName: string;
  profileId: 'dummy-6dof';
}

export interface RobotGatewayCapabilitiesV1 {
  contractVersion: '1.3';
  protocolAdapterId: 'dummy-ascii-v1';
  serialEnumeration: boolean;
  readOnlyConnection: boolean;
  liveTelemetry: boolean;
  hardwareCommands: boolean;
  directCommand: boolean;
  commandPolicy: GatewayCommandPolicy;
  allowedQueries: Array<'#GETJPOS' | '#GETMODE' | '#GETENABLE'>;
  supportedCommands: RobotCommandKind[];
  jointGroupSpeedLimitDegS: number | null;
  jointGroupCompletion: JointGroupCompletionPolicyV1 | null;
  engineeringJointSpeedMaxDegS: number | null;
}

export interface JointGroupCompletionPolicyV1 {
  positionToleranceDeg: number;
  settledDurationMs: number;
  timeoutMs: number;
}

export interface SimpleRobotCommand {
  commandId: string;
  sessionId: string;
  profileId: string;
}

export interface SetModeCommand extends SimpleRobotCommand {
  mode: DummyControlMode;
}

export interface JointStateFrame {
  sequence: number;
  profileId: string;
  timestampUtc: string;
  positionsDeg: number[];
  source: DataSource;
  validity: Validity;
}

export interface JointGroupCommand {
  commandId: string;
  sessionId: string;
  profileId: string;
  positionsDeg: number[];
  speedDegS?: number;
}

export interface DirectCommandRequest {
  requestId: string;
  sessionId: string;
  profileId: string;
  line: string;
}

export type DirectCommandStatus = 'sent' | 'replied' | 'rejected' | 'timedOut' | 'failed';

export interface DirectCommandResult {
  requestId: string;
  sessionId: string;
  status: DirectCommandStatus;
  evidence: CommandEvidence;
  normalizedLine: string;
  message: string;
  timestampUtc: string;
  deviceReply?: string | null | undefined;
}

export interface CommandResult {
  commandId: string;
  sessionId: string;
  commandKind: RobotCommandKind;
  status: CommandStatus;
  code: CommandResultCode;
  evidence: CommandEvidence;
  message: string;
  timestampUtc: string;
  deviceReply?: string | null | undefined;
}

export interface CommandAuditRecord {
  commandId: string;
  sessionId: string;
  profileId: string;
  commandKind: RobotCommandKind;
  acceptedAtUtc: string;
  request: RobotCommandRequestSnapshot;
  transmittedPayloads: string[];
  transmissionLogTruncated: boolean;
  result: CommandResult;
}

export interface RobotCommandRequestSnapshot {
  commandKind: RobotCommandKind;
  requestFingerprintSha256: string;
  mode: number | null;
  positionsDeg: number[] | null;
  positionsCount: number | null;
  speedDegS: number | null;
  payloadTruncated: boolean;
}

export interface ProtocolFrame {
  id: string;
  timestampUtc: string;
  direction: 'tx' | 'rx' | 'error';
  raw: string;
  parsedKind: string;
  source: DataSource;
  correlationId?: string;
}

export interface SignalDescriptor {
  signalId: string;
  displayName: string;
  unit: 'deg' | 'deg/s' | 'ms' | 'Hz';
  source: DataSource;
  color: string;
  dashed?: boolean;
  jointId?: string;
}

export interface SignalSample {
  timestampUtc: string;
  value: number | null;
  validity: Validity;
}

export interface SignalSeries {
  descriptor: SignalDescriptor;
  samples: SignalSample[];
}

export interface OperationEvent {
  id: string;
  timestampUtc: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  source: DataSource;
}

export interface DesktopBridgeCapabilities {
  available: boolean;
  minimize: boolean;
  toggleMaximize: boolean;
  close: boolean;
  exportDiagnostics: boolean;
}

export type DesktopBridgeAction = 'minimize' | 'toggleMaximize' | 'close' | 'beginDrag' | 'exportDiagnostics';

export interface DesktopBootstrapV1 {
  contractVersion: '1.0';
  gateway: {
    baseUrl: string;
    sessionToken: string;
  } | null;
  capabilities: DesktopBridgeCapabilities;
}

export interface DesktopBridgeRequestV1 {
  contractVersion: '1.0';
  requestId: string;
  action: DesktopBridgeAction;
}

export interface DesktopBridgeResponseV1 {
  contractVersion: '1.0';
  requestId: string;
  ok: boolean;
  errorCode?: 'unsupported' | 'invalidRequest' | 'hostFailure';
}
