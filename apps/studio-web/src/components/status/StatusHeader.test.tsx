import type { CommandAuditRecord, CommandResult, RobotGatewayCapabilitiesV1 } from '@aethor/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routeMeta';
import { showcaseJointFrame } from '../../fixtures/showcase';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { StatusHeader } from './StatusHeader';

const gatewayMocks = vi.hoisted(() => ({
  stopAndDisable: vi.fn(),
  getSession: vi.fn()
}));

vi.mock('../../integrations/gatewayInstance', () => ({
  robotGateway: {
    capabilities: { readOnlyConnection: false },
    stopAndDisable: gatewayMocks.stopAndDisable,
    getSession: gatewayMocks.getSession
  }
}));

describe('StatusHeader software stop safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActiveRobotProfileStore.setState({ activeProfileId: dummyProfile.profileId });
    useGatewayRuntimeStore.getState().resetRuntime();
    useGatewayRuntimeStore.getState().setCapabilities(supervisedCapabilities);
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1',
      profileId: 'dummy-6dof',
      connectionState: 'connected',
      motorState: 'enabled',
      controlMode: 2,
      timestampUtc: '2026-08-09T00:00:00.000Z',
      source: 'measured',
      validity: 'valid'
    });
  });

  it('latches an unconfirmed result when the stop response is lost', async () => {
    gatewayMocks.stopAndDisable.mockRejectedValueOnce(new Error('loopback response lost'));

    render(<Tooltip.Provider><StatusHeader route={routes[1]!} /></Tooltip.Provider>);
    fireEvent.click(screen.getByRole('button', { name: '软件急停' }));

    await waitFor(() => expect(useGatewayRuntimeStore.getState().latchedSafetyResult).toMatchObject({
      sessionId: 'session-1',
      commandKind: 'stopAndDisable',
      status: 'unconfirmed',
      code: 'transportError',
      evidence: 'none'
    }));
    expect(useGatewayRuntimeStore.getState().commandAuditStatus).toBe('error');
  });

  it('restores authoritative state and audit after a confirmed stop without relying on telemetry', async () => {
    const stopped = stopResult();
    const history = [audit(stopped)];
    const stopAndDisable = vi.fn(async () => stopped);
    const getSession = vi.fn(async () => ({
      ...useGatewayRuntimeStore.getState().session,
      motorState: 'disabled' as const,
      timestampUtc: stopped.timestampUtc
    }));
    const getJointState = vi.fn(async () => ({
      ...showcaseJointFrame,
      source: 'measured' as const,
      validity: 'valid' as const,
      timestampUtc: stopped.timestampUtc
    }));
    const getCommandHistory = vi.fn(async () => history);
    const gateway = {
      capabilities: {
        source: 'gateway', serialEnumeration: true, readOnlyConnection: true, hardwareCommands: true,
        rawCommand: false, liveTelemetry: true, commandPolicy: 'supervised',
        supportedCommands: ['enable', 'stopAndDisable', 'setMode'],
        jointGroupSpeedLimitDegS: null, jointGroupCompletion: null, engineeringJointSpeedMaxDegS: null
      },
      stopAndDisable,
      getSession,
      getJointState,
      getCommandHistory
    } as unknown as RobotGatewayV1;

    render(<Tooltip.Provider><StatusHeader route={routes[1]!} gateway={gateway} /></Tooltip.Provider>);
    fireEvent.click(screen.getByRole('button', { name: '软件急停' }));

    await waitFor(() => expect(useGatewayRuntimeStore.getState()).toMatchObject({
      session: { motorState: 'disabled' },
      commandAuditStatus: 'ready',
      commandHistory: [{ commandId: 'stop-1' }],
      lastCommandResult: { commandId: 'stop-1', status: 'completed' },
      latchedSafetyResult: null
    }));
    expect(stopAndDisable).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledOnce();
    expect(getJointState).toHaveBeenCalledOnce();
    expect(getCommandHistory).toHaveBeenCalledOnce();
  });

  it('never exposes the Dummy stop path while the Aethor_robo console is active', () => {
    useActiveRobotProfileStore.setState({ activeProfileId: aethorRoboProfile.profileId });
    render(<Tooltip.Provider><StatusHeader route={routes[0]!} /></Tooltip.Provider>);

    expect(screen.getByRole('button', { name: '软件急停' })).toBeDisabled();
    const profile = screen.getByRole('combobox', { name: '当前机器人配置' });
    expect(profile).toHaveTextContent('Current profile');
    expect(profile).toHaveTextContent('Aethor_robo');
    expect(profile).not.toHaveTextContent('DUAL 7-DOF');
    expect(screen.getByTitle('Aethor_robo 电机状态接口尚未定义')).toHaveTextContent(/MOTOR\s*N\/A/);
    expect(screen.getByTitle('Aethor_robo 当前没有硬件反馈数据，仅显示本地模型预览')).toHaveTextContent(/FEEDBACK\s*NO DATA/);
    expect(gatewayMocks.stopAndDisable).not.toHaveBeenCalled();
  });

  it('switches the global control context from the Current profile selector', async () => {
    useGatewayRuntimeStore.getState().resetRuntime();
    useActiveRobotProfileStore.setState({ activeProfileId: aethorRoboProfile.profileId });
    render(<Tooltip.Provider><StatusHeader route={routes[0]!} /></Tooltip.Provider>);

    const selector = screen.getByRole('combobox', { name: '当前机器人配置' });
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    const dummyOption = await screen.findByRole('option', { name: /Dummy/ });
    fireEvent.click(dummyOption);

    await waitFor(() => expect(useActiveRobotProfileStore.getState().activeProfileId).toBe(dummyProfile.profileId));
    expect(selector).toHaveTextContent('Dummy');
  });
});

const supervisedCapabilities: RobotGatewayCapabilitiesV1 = {
  contractVersion: '1.3',
  protocolAdapterId: 'dummy-ascii-v1',
  serialEnumeration: true,
  readOnlyConnection: true,
  liveTelemetry: true,
  hardwareCommands: true,
  directCommand: false,
  commandPolicy: 'supervised',
  allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
  supportedCommands: ['enable', 'stopAndDisable', 'setMode'],
  jointGroupSpeedLimitDegS: null,
  jointGroupCompletion: null,
  engineeringJointSpeedMaxDegS: null
};

function stopResult(): CommandResult {
  return {
    commandId: 'stop-1', sessionId: 'session-1', commandKind: 'stopAndDisable', status: 'completed',
    code: 'ok', evidence: 'feedbackConfirmed', message: 'disabled confirmed',
    timestampUtc: '2026-08-09T00:00:02.000Z'
  };
}

function audit(result: CommandResult): CommandAuditRecord {
  return {
    commandId: result.commandId,
    sessionId: result.sessionId,
    profileId: 'dummy-6dof',
    commandKind: result.commandKind,
    acceptedAtUtc: result.timestampUtc,
    request: {
      commandKind: result.commandKind,
      requestFingerprintSha256: '0'.repeat(64),
      mode: null,
      positionsDeg: null,
      positionsCount: null,
      speedDegS: null,
      payloadTruncated: false
    },
    transmittedPayloads: ['!STOP', '$0,0,0,0,0,0', '!DISABLE', '#GETENABLE'],
    transmissionLogTruncated: false,
    result
  };
}
