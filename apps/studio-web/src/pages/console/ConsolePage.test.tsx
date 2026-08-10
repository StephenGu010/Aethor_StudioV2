import { act, fireEvent, render, screen, within } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import { useAethorRoboConsoleStore } from '../../stores/useAethorRoboConsoleStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { ConsolePage } from './ConsolePage';

const sceneCapture = vi.hoisted(() => ({ props: null as null | {
  profile: { profileId: string; model: { dof: number } };
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
    expect(screen.getByRole('button', { name: '硬件协议待实现 · 禁止下发' })).toBeDisabled();
    expect(screen.getByText('No serial, feedback, enable or command path')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '硬件协议待实现 · 禁止下发' })).toBeDisabled();

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
    expect(screen.queryByLabelText('L-J1 目标角度')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
    expect(screen.getByText('Engineering direct gateway unavailable')).toBeInTheDocument();
  });
});
