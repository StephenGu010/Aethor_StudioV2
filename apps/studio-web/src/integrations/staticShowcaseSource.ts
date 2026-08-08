import type { CommandResult, JointGroupCommand } from '@aethor/contracts';
import { showcaseJointFrame, showcaseProtocolFrames, showcaseSession } from '../fixtures/showcase';
import type { RobotGatewayV1 } from './robotGateway';

export class StaticShowcaseSource implements RobotGatewayV1 {
  readonly capabilities = {
    hardwareCommands: false,
    rawCommand: false,
    liveTelemetry: false
  } as const;

  async getSession() {
    return showcaseSession;
  }

  async getJointState() {
    return showcaseJointFrame;
  }

  async getProtocolFrames() {
    return showcaseProtocolFrames;
  }

  async sendJointGroup(command: JointGroupCommand): Promise<CommandResult> {
    return unsupported(command.commandId, '静态展示源不支持物理关节下发');
  }

  async sendRaw(commandId: string, _raw: string): Promise<CommandResult> {
    return unsupported(commandId, '后端未连接；命令仅完成本地格式校验');
  }

  async emergencyStop(commandId: string): Promise<CommandResult> {
    return unsupported(commandId, '无法确认设备停机，请使用物理急停');
  }
}

function unsupported(commandId: string, message: string): CommandResult {
  return { commandId, status: 'unsupported', message, timestampUtc: new Date().toISOString() };
}

export const robotGateway = new StaticShowcaseSource();
