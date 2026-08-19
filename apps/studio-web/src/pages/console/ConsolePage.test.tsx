import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import {
  flushAethorTwinTelemetryForTest,
  ingestAethorTwinMotorFrame,
  resetAethorTwinTelemetryRuntime
} from '../../integrations/aethorTwinTelemetryRuntime';
import { useAethorRoboConsoleStore } from '../../stores/useAethorRoboConsoleStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { ConsolePage } from './ConsolePage';

const sceneCapture = vi.hoisted(() => ({ props: null as null | {
  profile: { profileId: string; model: { dof: number } };
  actualPositionsDeg: readonly number[];
  targetPositionsDeg: readonly number[];
  degradedActualJointIds?: readonly string[];
  cameraFocusGroupId?: string | null;
  onSelectedJointChange: (jointId: string) => void;
}, renderCount: 0 }));

vi.mock('../../components/visualization/RobotScene', () => ({
  RobotScene: (props: typeof sceneCapture.props) => {
    sceneCapture.props = props;
    sceneCapture.renderCount += 1;
    return <div data-testid="robot-scene" />;
  }
}));

describe('Aethor_robo dual-arm console', () => {
  beforeEach(() => {
    useActiveRobotProfileStore.setState({ activeProfileId: aethorRoboProfile.profileId });
    resetAethorTwinTelemetryRuntime();
    useAethorRoboConsoleStore.getState().resetPreview();
    sceneCapture.props = null;
    sceneCapture.renderCount = 0;
  });

  it('loads the fourteen-joint Aethor_robo profile and exposes one seven-axis group at a time', async () => {
    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);

    expect(await screen.findByTestId('robot-scene')).toBeInTheDocument();
    expect(sceneCapture.props?.profile).toMatchObject({ profileId: 'aethor-robo-dual-7dof', model: { dof: 14 } });
    expect(screen.getByRole('button', { name: '左臂 · 7轴' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('L-J7 目标角度')).toBeInTheDocument();
    expect(screen.queryByLabelText('R-J1 目标角度')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '右臂 · 7轴' }));
    expect(screen.getByLabelText('R-J1 目标角度')).toBeInTheDocument();
    expect(screen.getByLabelText('R-J7 目标角度')).toBeInTheDocument();
    expect(screen.queryByLabelText('L-J1 目标角度')).not.toBeInTheDocument();
  });

  it('keeps all edits local and permanently disables hardware actions while the protocol is pending', () => {
    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);

    fireEvent.change(screen.getByLabelText('L-J1 目标角度'), { target: { value: '25' } });

    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg[0]).toBe(25);
    expect(screen.getByRole('button', { name: '读取当前' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
    expect(screen.getByText('Gateway and firmware adapter not connected')).toBeInTheDocument();
  });

  it('maps unordered motor IDs to joints and surfaces missing, duplicate, and out-of-range IDs', async () => {
    act(() => {
      ingestAethorTwinMotorFrame({
      contractVersion: '1.0',
      profileId: 'aethor-robo-dual-7dof',
      jointGroupId: 'left-arm',
      controllerId: 'commissioning-controller',
      armId: 'left',
      bootId: 'boot-a',
      frameSeq: 1,
      receivedAtUtc: '2026-08-12T08:00:00.000Z',
      snapshotComplete: true,
      motors: [
        { motorId: 7, positionDeg: 72.5, feedbackAgeMs: 4, valid: true },
        { motorId: 3, positionDeg: 31.5, feedbackAgeMs: 3, valid: true },
        { motorId: 2, positionDeg: 20, feedbackAgeMs: 2, valid: true },
        { motorId: 8, positionDeg: 80, feedbackAgeMs: 2, valid: true },
        { motorId: 2, positionDeg: 21, feedbackAgeMs: 2, valid: true }
      ]
      });
      flushAethorTwinTelemetryForTest();
    });

    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);
    await screen.findByTestId('robot-scene');

    expect(sceneCapture.props?.actualPositionsDeg[2]).toBe(31.5);
    expect(sceneCapture.props?.actualPositionsDeg[6]).toBe(72.5);
    expect(sceneCapture.props?.degradedActualJointIds).toEqual(['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7']);
    expect(screen.getByText('2/7 motors fresh')).toBeInTheDocument();
    expect(screen.getByText('ID 2 conflict · ID 8 out of range')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择 L-J2 关节' }).closest('.jointRow')).toHaveAttribute('data-availability', 'conflict');
    expect(screen.getByRole('button', { name: '选择 L-J3 关节' }).closest('.jointRow')).toHaveAttribute('data-availability', 'present');
    expect(screen.getByRole('button', { name: '选择 L-J4 关节' }).closest('.jointRow')).toHaveAttribute('data-availability', 'missing');
  });

  it('keeps the last measured pose but revokes the source label after telemetry stalls', async () => {
    useAethorRoboConsoleStore.getState().applyMotorFrames([{
      contractVersion: '1.0',
      profileId: 'aethor-robo-dual-7dof',
      jointGroupId: 'left-arm',
      controllerId: 'commissioning-controller',
      armId: 'left',
      bootId: 'boot-a',
      frameSeq: 7,
      receivedAtUtc: '2026-08-13T08:00:00.000Z',
      snapshotComplete: false,
      motors: [{ motorId: 1, positionDeg: 18, feedbackAgeMs: 1, valid: true }]
    }], {
      receivedFrameCount: 1,
      appliedFrameCount: 1,
      coalescedFrameCount: 0,
      rejectedFrameCount: 0,
      renderCommitCount: 1,
      ingressRateHz: 1,
      modelUpdateRateHz: 1,
      lastIngressAtMs: 1_000,
      lastCommitAtMs: 1_000
    }, 1_000);

    const { container } = render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);
    await screen.findByTestId('robot-scene');
    expect(container.querySelector('.sceneLegend .sourceTag')).toHaveTextContent('MEASURED');
    expect(sceneCapture.props?.actualPositionsDeg[0]).toBe(18);

    act(() => useAethorRoboConsoleStore.getState().expireMotorTelemetry(1_249, 250));

    expect(container.querySelector('.sceneLegend .sourceTag')).toHaveTextContent('UNAVAILABLE');
    expect(screen.getByText('MEASURED STALE')).toBeInTheDocument();
    expect(sceneCapture.props?.actualPositionsDeg[0]).toBe(18);
    expect(sceneCapture.props?.degradedActualJointIds).toEqual(['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7']);
  });

  it('switches the visible control group when a joint is selected in the 3D model', async () => {
    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);
    await screen.findByTestId('robot-scene');

    act(() => sceneCapture.props?.onSelectedJointChange('j10'));

    expect(screen.getByRole('button', { name: '右臂 · 7轴' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('R-J3 目标角度')).toBeInTheDocument();
  });

  it('owns an explicit all/left/right camera focus without changing the hardware boundary', async () => {
    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);
    await screen.findByTestId('robot-scene');
    const focusControls = within(screen.getByRole('group', { name: '相机取景' }));

    expect(focusControls.getByRole('button', { name: '整机' })).toHaveAttribute('aria-pressed', 'true');
    expect(sceneCapture.props?.cameraFocusGroupId).toBeNull();

    fireEvent.click(focusControls.getByRole('button', { name: '右臂' }));
    expect(sceneCapture.props?.cameraFocusGroupId).toBe('right-arm');
    expect(screen.getByRole('button', { name: '右臂 · 7轴' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();

    fireEvent.click(focusControls.getByRole('button', { name: '整机' }));
    expect(sceneCapture.props?.cameraFocusGroupId).toBeNull();
  });

  it('does not rerender the 3D scene while a floating tool window position changes', async () => {
    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);
    await screen.findByTestId('robot-scene');
    const initialRenderCount = sceneCapture.renderCount;

    act(() => useWorkbenchStore.getState().setWindowPosition('diagnostics', 420, 120));

    expect(sceneCapture.renderCount).toBe(initialRenderCount);
  });

  it('loads the isolated Dummy six-axis console when that profile is active', async () => {
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
    useActiveRobotProfileStore.setState({ activeProfileId: dummyProfile.profileId });

    render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);

    expect(await screen.findByTestId('robot-scene')).toBeInTheDocument();
    expect(sceneCapture.props?.profile).toMatchObject({ profileId: 'dummy-6dof', model: { dof: 6 } });
    expect(screen.getByLabelText('J1 目标角度')).toBeInTheDocument();
    expect(screen.getByLabelText('J6 目标角度')).toBeInTheDocument();
    expect(screen.getByText('Dummy · #GETJPOS 设备角')).toBeInTheDocument();
    expect(screen.getByLabelText('J3 目标角度')).toHaveAttribute('min', '0');
    expect(screen.getByLabelText('J3 目标角度')).toHaveAttribute('max', '180');
    expect(screen.getByLabelText('J3 目标角度')).toHaveValue('108.6');
    expect(screen.getByLabelText('Dummy 整组速度')).toHaveValue(20);
    expect(screen.queryByLabelText('L-J1 目标角度')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
    expect(screen.getByText('Engineering direct gateway unavailable')).toBeInTheDocument();
  });

  it('shows live J3 and the advancing feedback sequence from protocol index two', async () => {
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
    useActiveRobotProfileStore.setState({ activeProfileId: dummyProfile.profileId });
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-j3', profileId: dummyProfile.profileId, connectionState: 'connected',
      motorState: 'disabled', controlMode: 2, timestampUtc: '2026-08-11T09:30:00.000Z',
      source: 'measured', validity: 'valid'
    });
    useGatewayRuntimeStore.getState().setJointState({
      sequence: 42, profileId: dummyProfile.profileId, timestampUtc: '2026-08-11T09:30:00.050Z',
      positionsDeg: [10, 20, 33.25, 40, 50, 60], source: 'measured', validity: 'valid'
    });

    const { container } = render(<Tooltip.Provider><ConsolePage /></Tooltip.Provider>);
    await screen.findByTestId('robot-scene');

    expect(sceneCapture.props?.actualPositionsDeg).toEqual([10, 20, 33.25, 40, 50, 60]);
    const feedbackHud = container.querySelector('.feedbackHud');
    expect(feedbackHud).not.toBeNull();
    expect(within(feedbackHud as HTMLElement).getByText('VALID · #42')).toBeInTheDocument();
    expect(within(feedbackHud as HTMLElement).getByText('J3')).toBeInTheDocument();
    expect(within(feedbackHud as HTMLElement).getByText('33.25°')).toBeInTheDocument();
  });
});
