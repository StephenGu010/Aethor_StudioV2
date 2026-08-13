import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { TerminalPage } from './TerminalPage';

describe('TerminalPage offline behavior', () => {
  beforeEach(() => {
    useActiveRobotProfileStore.setState({ activeProfileId: dummyProfile.profileId });
    robotGateway.capabilities.readOnlyConnection = false;
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
  });

  it('switches to the Aethor candidate terminal without exposing Dummy frames or TX', () => {
    useActiveRobotProfileStore.setState({ activeProfileId: aethorRoboProfile.profileId });
    robotGateway.capabilities.readOnlyConnection = true;
    useGatewayRuntimeStore.getState().appendProtocolFrame(measuredFrame('dummy-frame', '#GETJPOS', 'tx'));

    const { container } = render(<TerminalPage />);

    expect(screen.getByText('Aethor_robo 指令')).toBeVisible();
    expect(screen.getByText('AETHOR ADAPTER · PENDING')).toBeVisible();
    expect(screen.getByLabelText('Aethor Arm 候选协议命令')).toHaveValue('REQ 1 HELLO *<CRC16>');
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(container.querySelector('.terminalLog')?.textContent).not.toContain('#GETJPOS');
    expect(screen.queryByText('Dummy 指令')).not.toBeInTheDocument();
  });

  it('keeps real sending disabled and validates locally without adding a frame', () => {
    render(<TerminalPage />);
    const initialFrames = screen.getAllByText('SHOWCASE').length;
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /#CMDMODE 3/ }));
    expect(screen.getByText('MODE · FORMAT VALID')).toBeVisible();
    expect(screen.getAllByText('SHOWCASE')).toHaveLength(initialFrames);
  });

  it('keeps manual entry directly editable and rejects excluded modes', () => {
    render(<TerminalPage />);
    const input = screen.getByLabelText('Dummy ASCII 命令');
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: '#CMDMODE 5' } });
    expect(screen.getByText('INVALID')).toBeVisible();
    expect(screen.getByText(/仅允许 Dummy 模式 1–3/)).toBeVisible();
  });

  it('does not substitute static frames for an empty configured gateway buffer', () => {
    robotGateway.capabilities.readOnlyConnection = true;
    useGatewayRuntimeStore.getState().setSession(measuredSession('connected'));
    const { container } = render(<TerminalPage />);

    expect(screen.getByText('SESSION FRAMES · WAITING')).toBeVisible();
    expect(screen.getByText(/未使用展示记录回填/)).toBeVisible();
    expect(container.querySelectorAll('.protocolRow')).toHaveLength(0);
  });

  it('clears only current frame ids so newly arriving evidence remains visible', () => {
    robotGateway.capabilities.readOnlyConnection = true;
    useGatewayRuntimeStore.getState().setSession(measuredSession('connected'));
    useGatewayRuntimeStore.getState().appendProtocolFrame(measuredFrame('old', '#GETJPOS'));
    const { container } = render(<TerminalPage />);
    expect(container.querySelectorAll('.protocolRow')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '清空视图' }));
    expect(container.querySelectorAll('.protocolRow')).toHaveLength(0);

    act(() => useGatewayRuntimeStore.getState().appendProtocolFrame(measuredFrame('new', 'ok 1 2 3 4 5 6')));
    expect(screen.getByText('ok 1 2 3 4 5 6')).toBeVisible();
  });

  it('hides routine GETJPOS traffic by default without deleting it and can show it on demand', () => {
    robotGateway.capabilities.readOnlyConnection = true;
    useGatewayRuntimeStore.getState().setSession(measuredSession('connected'));
    useGatewayRuntimeStore.getState().appendProtocolFrame(measuredFrame(
      'poll-tx', '#GETJPOS', 'tx', 'query', 'poll-1'
    ));
    useGatewayRuntimeStore.getState().appendProtocolFrame(measuredFrame(
      'poll-rx', 'ok 1 2 3 4 5 6', 'rx', 'jointPositions', 'poll-1'
    ));
    useGatewayRuntimeStore.getState().appendProtocolFrame(measuredFrame(
      'mode-rx', 'ok 2 INT_POINT', 'rx', 'mode', 'mode-1'
    ));
    const { container } = render(<TerminalPage />);

    expect(container.querySelectorAll('.protocolRow')).toHaveLength(1);
    expect(container.querySelector('.terminalLog')?.textContent).not.toContain('#GETJPOS');
    expect(useGatewayRuntimeStore.getState().protocolFrames).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '显示 GETJPOS' }));
    expect(container.querySelectorAll('.protocolRow')).toHaveLength(3);
    expect(container.querySelector('.terminalLog')?.textContent).toContain('#GETJPOS');

    fireEvent.click(screen.getByRole('button', { name: '隐藏 GETJPOS' }));
    expect(container.querySelectorAll('.protocolRow')).toHaveLength(1);
    expect(useGatewayRuntimeStore.getState().protocolFrames).toHaveLength(3);
  });

  it('sends a validated command through the engineering gateway without adding fake frames', async () => {
    const sendDirectCommand = vi.fn(async (request) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      status: 'queued' as const,
      evidence: 'gatewayAccepted' as const,
      normalizedLine: request.line,
      message: '请求已进入网关有界发送队列',
      timestampUtc: '2026-08-09T00:00:01.000Z'
    }));
    const gateway = {
      capabilities: {
        ...robotGateway.capabilities,
        readOnlyConnection: true,
        hardwareCommands: true,
        rawCommand: true,
        commandPolicy: 'engineering' as const,
        engineeringJointSpeedMaxDegS: 100
      },
      sendDirectCommand
    } as unknown as RobotGatewayV1;
    useGatewayRuntimeStore.getState().setSession(measuredSession('connected'));
    render(<TerminalPage gateway={gateway} />);

    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('QUEUED')).toBeVisible();
    expect(sendDirectCommand).toHaveBeenCalledWith(expect.objectContaining({ line: '#GETJPOS', sessionId: 'session-1' }));
    expect(useGatewayRuntimeStore.getState().protocolFrames).toHaveLength(0);
  });

  it('allows a second manual joint target while measured feedback is stale after a prior write', async () => {
    const sendDirectCommand = vi.fn(async (request) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      status: 'sent' as const,
      evidence: 'transportWritten' as const,
      normalizedLine: request.line,
      message: '整组关节角已写入串口；由操作者确认',
      timestampUtc: '2026-08-12T00:00:01.000Z'
    }));
    const gateway = {
      capabilities: {
        ...robotGateway.capabilities,
        readOnlyConnection: true,
        hardwareCommands: true,
        rawCommand: true,
        commandPolicy: 'engineering' as const,
        engineeringJointSpeedMaxDegS: 100
      },
      sendDirectCommand
    } as unknown as RobotGatewayV1;
    useGatewayRuntimeStore.getState().setSession({
      ...measuredSession('connected'), motorState: 'enabled', controlMode: 1, validity: 'stale'
    });
    useGatewayRuntimeStore.getState().setJointState({
      sequence: 7,
      profileId: 'dummy-6dof',
      timestampUtc: '2026-08-12T00:00:00.000Z',
      positionsDeg: [0, 0, 0, 0, 0, 0],
      source: 'measured',
      validity: 'stale'
    });
    render(<TerminalPage gateway={gateway} />);

    fireEvent.change(screen.getByLabelText('Dummy ASCII 命令'), {
      target: { value: '>1,2,3,4,5,6,10' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('SENT')).toBeVisible();
    expect(sendDirectCommand).toHaveBeenCalledWith(expect.objectContaining({ line: '>1,2,3,4,5,6,10' }));
  });

  it('accepts consecutive direct requests and renders their independent queue states', async () => {
    let sequence = 0;
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sendDirectCommand = vi.fn(async (request) => {
      sequence += 1;
      if (sequence === 1) await firstResponse;
      return {
        requestId: request.requestId,
        sessionId: request.sessionId,
        status: 'queued' as const,
        evidence: 'gatewayAccepted' as const,
        normalizedLine: request.line,
        message: '请求已进入有界串口队列',
        timestampUtc: `2026-08-13T00:00:0${sequence}.000Z`
      };
    });
    const gateway = {
      capabilities: {
        ...robotGateway.capabilities,
        readOnlyConnection: true,
        hardwareCommands: true,
        rawCommand: true,
        commandPolicy: 'engineering' as const,
        engineeringJointSpeedMaxDegS: 100
      },
      sendDirectCommand
    } as unknown as RobotGatewayV1;
    useGatewayRuntimeStore.getState().setSession(measuredSession('connected'));
    render(<TerminalPage gateway={gateway} />);

    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.change(screen.getByLabelText('Dummy ASCII 命令'), { target: { value: '#GETMODE' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(sendDirectCommand).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
    expect(await screen.findByText('#GETMODE')).toBeVisible();
    releaseFirst();
    expect(await screen.findByText('#GETJPOS')).toBeVisible();
    expect(screen.getAllByText('QUEUED')).toHaveLength(2);
  });
});

function measuredSession(connectionState: 'connected' | 'offline') {
  return {
    sessionId: 'session-1', profileId: 'dummy-6dof', connectionState, motorState: 'disabled' as const,
    controlMode: 1 as const, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured' as const,
    validity: connectionState === 'connected' ? 'valid' as const : 'unavailable' as const
  };
}

function measuredFrame(
  id: string,
  raw: string,
  direction: 'tx' | 'rx' | 'error' = 'rx',
  parsedKind = 'TEST',
  correlationId?: string
) {
  return {
    id, timestampUtc: '2026-08-09T00:00:00.000Z', direction,
    raw, parsedKind, source: 'measured' as const,
    ...(correlationId ? { correlationId } : {})
  };
}
