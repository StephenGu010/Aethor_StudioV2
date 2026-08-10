import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { TerminalPage } from './TerminalPage';

describe('TerminalPage offline behavior', () => {
  beforeEach(() => {
    robotGateway.capabilities.readOnlyConnection = false;
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
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

  it('sends a validated command through the engineering gateway without adding fake frames', async () => {
    const sendDirectCommand = vi.fn(async (request) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      status: 'replied' as const,
      evidence: 'feedbackConfirmed' as const,
      normalizedLine: request.line,
      message: '设备已返回匹配应答',
      timestampUtc: '2026-08-09T00:00:01.000Z',
      deviceReply: 'ok 0 0 0 0 0 0'
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

    expect(await screen.findByText('REPLIED')).toBeVisible();
    expect(sendDirectCommand).toHaveBeenCalledWith(expect.objectContaining({ line: '#GETJPOS', sessionId: 'session-1' }));
    expect(useGatewayRuntimeStore.getState().protocolFrames).toHaveLength(0);
  });
});

function measuredSession(connectionState: 'connected' | 'offline') {
  return {
    sessionId: 'session-1', profileId: 'dummy-6dof', connectionState, motorState: 'disabled' as const,
    controlMode: 1 as const, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured' as const,
    validity: connectionState === 'connected' ? 'valid' as const : 'unavailable' as const
  };
}

function measuredFrame(id: string, raw: string) {
  return {
    id, timestampUtc: '2026-08-09T00:00:00.000Z', direction: 'rx' as const,
    raw, parsedKind: 'TEST', source: 'measured' as const
  };
}
