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

export interface RobotJointProfile {
  jointId: string;
  displayName: string;
  urdfJointName: string;
  protocolIndex: number;
  lowerDeg: number;
  upperDeg: number;
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

export interface CommandResult {
  commandId: string;
  status: CommandStatus;
  message: string;
  timestampUtc: string;
  deviceReply?: string;
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
}
