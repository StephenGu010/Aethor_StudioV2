import type { RobotSessionSnapshot } from '@aethor/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it, vi } from 'vitest';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { DeviceModelPage } from './DeviceModelPage';

describe('DeviceModelPage Phase 4 safety states', () => {
  it('keeps serial selection and every hardware action disabled without gateway config', () => {
    render(<Tooltip.Provider><DeviceModelPage /></Tooltip.Provider>);

    expect(screen.getByText('BACKEND ABSENT')).toBeInTheDocument();
    expect(screen.getByLabelText('串口')).toBeDisabled();
    expect(screen.getByRole('button', { name: /只读连接/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /停止并去使能/ })).toBeDisabled();
    expect(screen.getByText(/静态数据不会提升为在线状态/)).toBeInTheDocument();
  });

  it('enumerates without auto-connecting and requires an explicit port selection', async () => {
    const offline = session('offline', 'unavailable');
    const connected = session('connected', 'stale');
    const closeTelemetry = vi.fn(async () => {});
    const connectReadOnly = vi.fn(async () => connected);
    const gateway: RobotGatewayV1 = {
      capabilities: {
        source: 'readonlyGateway', serialEnumeration: true, readOnlyConnection: true,
        hardwareCommands: false, rawCommand: false, liveTelemetry: true
      },
      getReadOnlyCapabilities: async () => ({
        contractVersion: '1.0', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
        readOnlyConnection: true, liveTelemetry: true, hardwareCommands: false,
        allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE']
      }),
      listSerialPorts: async () => [{ portName: 'COM4', hardwareId: null, displayName: 'Dummy USB · COM4' }],
      connectReadOnly,
      disconnect: async () => offline,
      openTelemetry: async () => closeTelemetry,
      getSession: async () => offline,
      getJointState: async () => ({
        sequence: 0, profileId: 'dummy-6dof', timestampUtc: offline.timestampUtc,
        positionsDeg: [0, 0, 0, 0, 0, 0], source: 'unavailable', validity: 'unavailable'
      }),
      getProtocolFrames: async () => [],
      sendJointGroup: async (command) => ({ commandId: command.commandId, status: 'unsupported', message: 'read only', timestampUtc: offline.timestampUtc }),
      sendRaw: async (commandId) => ({ commandId, status: 'unsupported', message: 'read only', timestampUtc: offline.timestampUtc }),
      emergencyStop: async (commandId) => ({ commandId, status: 'unsupported', message: 'read only', timestampUtc: offline.timestampUtc })
    };

    const { unmount } = render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);
    await screen.findByRole('option', { name: 'Dummy USB · COM4' });
    expect(connectReadOnly).not.toHaveBeenCalled();
    const connectButton = screen.getByRole('button', { name: /只读连接/ });
    expect(connectButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('串口'), { target: { value: 'COM4' } });
    expect(connectButton).toBeEnabled();
    fireEvent.click(connectButton);
    await waitFor(() => expect(connectReadOnly).toHaveBeenCalledWith({ portName: 'COM4', profileId: 'dummy-6dof' }));
    await waitFor(() => expect(screen.getAllByText('CONNECTED').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();

    unmount();
    await waitFor(() => expect(closeTelemetry).toHaveBeenCalledOnce());
  });
});

function session(connectionState: RobotSessionSnapshot['connectionState'], validity: RobotSessionSnapshot['validity']): RobotSessionSnapshot {
  return {
    sessionId: connectionState === 'offline' ? 'offline' : 'session-1',
    profileId: 'dummy-6dof', connectionState, motorState: 'unknown', controlMode: null,
    timestampUtc: '2026-08-08T10:00:00.000Z', source: connectionState === 'offline' ? 'unavailable' : 'measured', validity
  };
}
