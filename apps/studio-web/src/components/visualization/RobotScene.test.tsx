import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dummyProfile, dummyUrdfUrl } from '../../profile/dummyProfile';
import { RobotScene } from './RobotScene';

describe('RobotScene fallback', () => {
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
});
