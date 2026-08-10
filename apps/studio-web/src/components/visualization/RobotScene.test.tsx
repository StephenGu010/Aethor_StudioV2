import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dummyProfile, dummyUrdfUrl } from '../../profile/dummyProfile';
import { RobotScene } from './RobotScene';

const sceneTestState = vi.hoisted(() => ({
  webglSupported: false,
  canvasProps: undefined as { frameloop?: string } | undefined
}));

vi.mock('./sceneCapabilities', () => ({
  detectSceneCapabilities: () => sceneTestState.webglSupported
    ? { supported: true, quality: 'balanced' as const }
    : { supported: false, quality: 'constrained' as const, reason: 'WEBGL_UNAVAILABLE' as const }
}));

vi.mock('@react-three/fiber', () => ({
  Canvas: (props: { fallback?: ReactNode; frameloop?: string }) => {
    sceneTestState.canvasProps = props;
    return <canvas>{props.fallback}</canvas>;
  },
  createPortal: vi.fn(),
  useFrame: vi.fn(),
  useThree: vi.fn()
}));

describe('RobotScene fallback', () => {
  beforeEach(() => {
    sceneTestState.webglSupported = false;
    sceneTestState.canvasProps = undefined;
  });

  it('keeps local joint controls available while reporting unavailable WebGL honestly', async () => {
    const onModelState = vi.fn();
    render(
      <RobotScene
        profile={dummyProfile}
        urdfUrl={dummyUrdfUrl}
        actualPositionsDeg={[0, 0, 0, 0, 0, 0]}
        targetPositionsDeg={[0, 0, 0, 0, 0, 0]}
        selectedJointId="j1"
        cameraResetSignal={0}
        settings={{
          showVisual: true,
          showCollision: false,
          showGrid: true,
          showShadows: true,
          showLighting: true,
          showBaseFrame: true,
          showTcpFrame: true,
          showJointAxes: false
        }}
        onSelectedJointChange={vi.fn()}
        onJointTargetChange={vi.fn()}
        onModelState={onModelState}
        onCapabilityState={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('3D VIEW UNAVAILABLE');
    expect(screen.getByRole('alert')).toHaveTextContent('不会下发硬件');
    await waitFor(() => expect(onModelState).toHaveBeenCalledWith('error'));
  });

  it('does not expose an initialization failure alert while the canvas is available', () => {
    sceneTestState.webglSupported = true;

    render(
      <RobotScene
        profile={dummyProfile}
        urdfUrl={dummyUrdfUrl}
        actualPositionsDeg={[0, 0, 0, 0, 0, 0]}
        targetPositionsDeg={[0, 0, 0, 0, 0, 0]}
        selectedJointId="j1"
        cameraResetSignal={0}
        settings={{
          showVisual: true,
          showCollision: false,
          showGrid: true,
          showShadows: true,
          showLighting: true,
          showBaseFrame: true,
          showTcpFrame: true,
          showJointAxes: false
        }}
        onSelectedJointChange={vi.fn()}
        onJointTargetChange={vi.fn()}
        onModelState={vi.fn()}
        onCapabilityState={vi.fn()}
      />
    );

    expect(document.querySelector('canvas')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('WEBGL INITIALIZATION FAILED')).not.toBeInTheDocument();
    expect(sceneTestState.canvasProps?.frameloop).toBe('demand');
  });
});
