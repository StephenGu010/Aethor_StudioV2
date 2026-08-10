import type { JointStateFrame, RobotSessionSnapshot } from '@aethor/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showcaseJointFrame } from '../../fixtures/showcase';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { SerialSessionControl } from './SerialSessionControl';

describe('SerialSessionControl', () => {
  beforeEach(() => {
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
  });

  it('enumerates without auto-connecting and opens the explicitly selected port', async () => {
    const connect = vi.fn(async () => connectedSession());
    const gateway = fakeGateway({ connect });
    renderControl(gateway);

    const port = await screen.findByRole('option', { name: 'Dummy USB · COM4' });
    expect(port).toBeVisible();
    expect(connect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '连接' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('串口'), { target: { value: 'COM4' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await waitFor(() => expect(connect).toHaveBeenCalledWith({ portName: 'COM4', profileId: 'dummy-6dof' }));
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      activePortName: 'COM4',
      session: { connectionState: 'connected', sessionId: 'session-1' }
    });
    expect(useRobotSessionStore.getState()).toMatchObject({
      hardwareSessionId: 'session-1',
      measuredAlignmentPending: true
    });
  });

  it('blocks release only while the motor is confirmed enabled', async () => {
    const disconnect = vi.fn(async () => offlineSession());
    const gateway = fakeGateway({ disconnect });
    useGatewayRuntimeStore.getState().setSession({ ...connectedSession(), motorState: 'enabled' });
    useGatewayRuntimeStore.getState().setActivePortName('COM4');
    const rendered = renderControl(gateway);

    expect(screen.getByRole('button', { name: '断开' })).toBeDisabled();
    useGatewayRuntimeStore.getState().setSession(connectedSession());
    rendered.rerender(<Tooltip.Provider><SerialSessionControl gateway={gateway} enabled /></Tooltip.Provider>);
    fireEvent.click(screen.getByRole('button', { name: '断开' }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(useGatewayRuntimeStore.getState()).toMatchObject({ activePortName: null, session: { connectionState: 'offline' } });
  });

  it('releases a wrong port that opened but never produced valid feedback', async () => {
    const disconnect = vi.fn(async () => offlineSession());
    const gateway = fakeGateway({ disconnect });
    useGatewayRuntimeStore.getState().setSession({
      ...connectedSession(),
      motorState: 'unknown',
      controlMode: null,
      validity: 'stale'
    });
    useGatewayRuntimeStore.getState().setActivePortName('COM1');
    renderControl(gateway);

    const release = screen.getByRole('button', { name: '断开' });
    expect(release).toBeEnabled();
    fireEvent.click(release);

    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      activePortName: null,
      session: { connectionState: 'offline' }
    });
  });

  it('allows an unknown emergency-stop result to be released before an explicit reconnect', async () => {
    const disconnect = vi.fn(async () => offlineSession());
    const connect = vi.fn(async () => ({ ...connectedSession(), sessionId: 'session-2' }));
    const gateway = fakeGateway({ disconnect, connect });
    useGatewayRuntimeStore.getState().setSession({
      ...connectedSession(),
      motorState: 'unknown',
      validity: 'stale'
    });
    useGatewayRuntimeStore.getState().setActivePortName('COM4');
    useGatewayRuntimeStore.getState().setLastCommandResult({
      commandId: 'stop-unknown',
      sessionId: 'session-1',
      commandKind: 'stopAndDisable',
      status: 'unconfirmed',
      code: 'transportError',
      evidence: 'none',
      message: '停止请求的物理结果未知',
      timestampUtc: '2026-08-10T00:00:00.500Z'
    });
    renderControl(gateway);

    fireEvent.click(screen.getByRole('button', { name: '断开' }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(useGatewayRuntimeStore.getState().latchedSafetyResult).toBeNull();
    await screen.findByRole('option', { name: 'Dummy USB · COM4' });
    fireEvent.change(screen.getByLabelText('串口'), { target: { value: 'COM4' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));

    await waitFor(() => expect(connect).toHaveBeenCalledWith({ portName: 'COM4', profileId: 'dummy-6dof' }));
    expect(useGatewayRuntimeStore.getState().session.sessionId).toBe('session-2');
  });

  it('does not enumerate or expose Dummy connection actions for Aethor_robo', () => {
    const listSerialPorts = vi.fn(async () => []);
    const gateway = fakeGateway({ listSerialPorts });
    renderControl(gateway, false);

    expect(screen.getByLabelText('串口')).toBeDisabled();
    expect(screen.getByRole('button', { name: '连接' })).toBeDisabled();
    expect(listSerialPorts).not.toHaveBeenCalled();
  });
});

function renderControl(gateway: RobotGatewayV1, enabled = true) {
  return render(<Tooltip.Provider><SerialSessionControl gateway={gateway} enabled={enabled} /></Tooltip.Provider>);
}

function fakeGateway(overrides: Partial<RobotGatewayV1> = {}): RobotGatewayV1 {
  const gateway = {
    capabilities: {
      source: 'gateway', serialEnumeration: true, readOnlyConnection: true, hardwareCommands: false,
      rawCommand: false, liveTelemetry: true, commandPolicy: 'disabled', supportedCommands: [],
      jointGroupSpeedLimitDegS: null, jointGroupCompletion: null, engineeringJointSpeedMaxDegS: null
    },
    getCapabilities: async () => null,
    listSerialPorts: async () => [{ portName: 'COM4', hardwareId: null, displayName: 'Dummy USB · COM4' }],
    connect: async () => connectedSession(),
    disconnect: async () => offlineSession(),
    openTelemetry: async () => async () => {},
    getSession: async () => offlineSession(),
    getJointState: async (): Promise<JointStateFrame> => ({ ...showcaseJointFrame, source: 'unavailable', validity: 'unavailable' }),
    getProtocolFrames: async () => [],
    getCommandHistory: async () => [],
    enable: async () => { throw new Error('not used'); },
    stopAndDisable: async () => { throw new Error('not used'); },
    home: async () => { throw new Error('not used'); },
    reset: async () => { throw new Error('not used'); },
    setMode: async () => { throw new Error('not used'); },
    sendJointGroup: async () => { throw new Error('not used'); },
    sendDirectCommand: async () => { throw new Error('not used'); }
  } satisfies RobotGatewayV1;
  return { ...gateway, ...overrides };
}

function connectedSession(): RobotSessionSnapshot {
  return {
    sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
    controlMode: 2, timestampUtc: '2026-08-10T00:00:00.000Z', source: 'measured', validity: 'valid'
  };
}

function offlineSession(): RobotSessionSnapshot {
  return {
    sessionId: 'offline', profileId: 'dummy-6dof', connectionState: 'offline', motorState: 'unknown',
    controlMode: null, timestampUtc: '2026-08-10T00:00:01.000Z', source: 'unavailable', validity: 'unavailable'
  };
}
