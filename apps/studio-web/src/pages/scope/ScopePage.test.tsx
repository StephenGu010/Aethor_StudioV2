import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { robotGateway } from '../../integrations/gatewayInstance';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { ScopePage } from './ScopePage';

vi.mock('../../components/charts/SignalChart', () => ({
  SignalChart: () => <div data-testid="signal-chart" />
}));

describe('ScopePage source truth', () => {
  beforeEach(() => {
    robotGateway.capabilities.readOnlyConnection = false;
    useGatewayRuntimeStore.getState().resetRuntime();
  });

  it('labels the bundled capture as showcase and keeps live-only windows disabled', () => {
    renderScope();
    expect(screen.getByText('LIVE UNAVAILABLE')).toBeVisible();
    expect(screen.getByText('展示采集并非实时测量')).toBeVisible();
    expect(screen.getByRole('option', { name: /60 s/ })).toBeDisabled();
    expect(screen.getByTestId('signal-chart')).toBeVisible();
  });

  it('preserves an explicitly empty URL signal selection', () => {
    renderScope('/scope?signals=');
    expect(screen.getByText('请选择至少一个信号')).toBeVisible();
    expect(screen.queryByTestId('signal-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled();
  });

  it('does not substitute showcase samples when a configured gateway has no frames', () => {
    robotGateway.capabilities.readOnlyConnection = true;
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
      controlMode: 1, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    renderScope();

    expect(screen.getByText('LIVE WAITING')).toBeVisible();
    expect(screen.getByText('实时缓冲区暂无可信遥测帧')).toBeVisible();
    expect(screen.queryByTestId('signal-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled();
  });

  it('shows measured data only after a valid frame enters the active session', () => {
    robotGateway.capabilities.readOnlyConnection = true;
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
      controlMode: 1, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    useGatewayRuntimeStore.getState().setJointState({
      sequence: 1, profileId: 'dummy-6dof', timestampUtc: '2026-08-09T00:00:00.050Z',
      positionsDeg: [1, 2, 3, 4, 5, 6], source: 'measured', validity: 'valid'
    });
    renderScope();

    expect(screen.getByText('LIVE MEASURED')).toBeVisible();
    expect(screen.getByTestId('signal-chart')).toBeVisible();
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeEnabled();
  });
});

function renderScope(path = '/scope') {
  return render(<MemoryRouter initialEntries={[path]}><ScopePage /></MemoryRouter>);
}
