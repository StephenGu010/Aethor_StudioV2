import type {
  CommandResult,
  JointGroupCommand,
  JointStateFrame,
  ProtocolFrame,
  RobotSessionSnapshot
} from '../contracts/types';

export interface RobotGatewayCapabilities {
  hardwareCommands: boolean;
  rawCommand: boolean;
  liveTelemetry: boolean;
}

export interface RobotGatewayV1 {
  readonly capabilities: RobotGatewayCapabilities;
  getSession(): Promise<RobotSessionSnapshot>;
  getJointState(): Promise<JointStateFrame>;
  getProtocolFrames(): Promise<ProtocolFrame[]>;
  sendJointGroup(command: JointGroupCommand): Promise<CommandResult>;
  sendRaw(commandId: string, raw: string): Promise<CommandResult>;
  emergencyStop(commandId: string): Promise<CommandResult>;
}

