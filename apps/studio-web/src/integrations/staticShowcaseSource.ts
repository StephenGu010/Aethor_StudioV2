import type {
  ActionProgramRunSnapshotV1,
  ActionProgramRunStartRequestV1,
  CommandResult,
  DirectCommandRequest,
  DirectCommandResult,
  JointGroupCommand,
  RobotConnectRequest,
  RobotCommandKind,
  RobotSessionSnapshot,
  SetModeCommand,
  SimpleRobotCommand
} from '@aethor/contracts';
import { showcaseJointFrame, showcaseProtocolFrames, showcaseSession } from '../fixtures/showcase';
import type { RobotGatewayCapabilities, RobotGatewayV1 } from './robotGateway';

export class StaticShowcaseSource implements RobotGatewayV1 {
  constructor(readonly unavailableReason = '未配置本机 C# 机器人网关') {}

  readonly capabilities: RobotGatewayCapabilities = {
    source: 'showcase',
    serialEnumeration: false,
    readOnlyConnection: false,
    hardwareCommands: false,
    rawCommand: false,
    liveTelemetry: false,
    commandPolicy: 'disabled',
    supportedCommands: [],
    jointGroupSpeedLimitDegS: null,
    jointGroupCompletion: null,
    engineeringJointSpeedMaxDegS: null
  };

  async getCapabilities() {
    return null;
  }

  async listSerialPorts() {
    return [];
  }

  async connect(_request: RobotConnectRequest): Promise<RobotSessionSnapshot> {
    throw new Error('后端未配置；静态展示源不能连接串口');
  }

  async disconnect() {
    return showcaseSession;
  }

  async openTelemetry() {
    return async () => {};
  }

  async getSession() {
    return showcaseSession;
  }

  async getJointState() {
    return showcaseJointFrame;
  }

  async getProtocolFrames() {
    return showcaseProtocolFrames;
  }

  async getCommandHistory() {
    return [];
  }

  async getDirectCommandHistory() {
    return [];
  }

  async getActionProgramRun() {
    return null;
  }

  async enable(command: SimpleRobotCommand): Promise<CommandResult> {
    return unsupported(command, 'enable');
  }

  async stopAndDisable(command: SimpleRobotCommand): Promise<CommandResult> {
    return unsupported(command, 'stopAndDisable');
  }

  async home(command: SimpleRobotCommand): Promise<CommandResult> {
    return unsupported(command, 'home');
  }

  async reset(command: SimpleRobotCommand): Promise<CommandResult> {
    return unsupported(command, 'reset');
  }

  async setMode(command: SetModeCommand): Promise<CommandResult> {
    return unsupported(command, 'setMode');
  }

  async sendJointGroup(command: JointGroupCommand): Promise<CommandResult> {
    return unsupported(command, 'jointGroup');
  }

  async sendDirectCommand(command: DirectCommandRequest): Promise<DirectCommandResult> {
    return {
      requestId: command.requestId,
      sessionId: command.sessionId,
      status: 'rejected',
      evidence: 'none',
      normalizedLine: command.line.trim(),
      message: '静态展示源不能执行直连硬件命令',
      timestampUtc: new Date().toISOString()
    };
  }

  async startActionProgram(request: ActionProgramRunStartRequestV1): Promise<ActionProgramRunSnapshotV1> {
    return unsupportedActionRun(request, '静态展示源不能运行动作程序');
  }

  async stopActionProgram(): Promise<ActionProgramRunSnapshotV1> {
    throw new Error('静态展示源没有正在运行的动作程序');
  }
}

function unsupportedActionRun(
  request: ActionProgramRunStartRequestV1,
  message: string
): ActionProgramRunSnapshotV1 {
  const timestampUtc = new Date().toISOString();
  return {
    contractVersion: '1.0', runId: request.runId, programId: request.programId, revision: request.revision,
    sessionId: request.sessionId, profileId: 'dummy-6dof', state: 'rejected', currentWaypointIndex: null,
    waypointCount: request.waypoints.length, completedCycles: 0, loopEnabled: request.loopEnabled,
    speedDegS: request.speedDegS, lastRequestId: null, lastEvidence: 'none',
    physicalCompletionConfirmed: false, message, startedAtUtc: timestampUtc, updatedAtUtc: timestampUtc,
    finishedAtUtc: timestampUtc
  };
}

function unsupported(command: SimpleRobotCommand, commandKind: RobotCommandKind): CommandResult {
  return {
    commandId: command.commandId,
    sessionId: command.sessionId,
    commandKind,
    status: 'unsupported',
    code: 'commandsDisabled',
    evidence: 'none',
    message: '静态展示源不能执行物理硬件命令',
    timestampUtc: new Date().toISOString()
  };
}
