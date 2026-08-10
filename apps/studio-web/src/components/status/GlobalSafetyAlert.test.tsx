import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { GlobalSafetyAlert } from './GlobalSafetyAlert';

describe('GlobalSafetyAlert', () => {
  beforeEach(() => useGatewayRuntimeStore.getState().resetRuntime());

  it('keeps an unconfirmed software stop visible with physical emergency-stop guidance', () => {
    useGatewayRuntimeStore.getState().setLastCommandResult({
      commandId: 'stop-1', sessionId: 'showcase-offline', commandKind: 'stopAndDisable', status: 'unconfirmed',
      code: 'transportError', evidence: 'none', message: '停止请求的物理结果未知',
      timestampUtc: '2026-08-09T00:00:00.000Z'
    });

    render(<GlobalSafetyAlert />);

    expect(screen.getByRole('alert')).toHaveTextContent('SOFTWARE STOP UNCONFIRMED');
    expect(screen.getByRole('alert')).toHaveTextContent('立即使用物理急停');
  });

  it('shows stale telemetry globally without claiming a live measured state', () => {
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    useGatewayRuntimeStore.getState().markTelemetryDegraded('SignalR disconnected');

    render(<GlobalSafetyAlert />);

    expect(screen.getByRole('status')).toHaveTextContent('TELEMETRY DEGRADED');
    expect(screen.getByRole('status')).toHaveTextContent('不允许据此下发运动');
  });
});
