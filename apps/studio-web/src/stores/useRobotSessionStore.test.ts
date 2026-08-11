import { beforeEach, describe, expect, it } from 'vitest';
import { showcaseJointFrame } from '../fixtures/showcase';
import { useRobotSessionStore } from './useRobotSessionStore';

describe('target and feedback isolation', () => {
  beforeEach(() => useRobotSessionStore.getState().resetSession());

  it('edits only the target draft and clamps it to profile limits', () => {
    const feedbackBefore = [...showcaseJointFrame.positionsDeg];
    useRobotSessionStore.getState().setJointTarget(0, 999);
    expect(useRobotSessionStore.getState().targetPositionsDeg[0]).toBe(170);
    expect(showcaseJointFrame.positionsDeg).toEqual(feedbackBefore);
  });

  it('aligns a new hardware session to the first measured pose without overwriting user intent', () => {
    const store = useRobotSessionStore.getState();
    store.beginHardwareSession('session-1');
    store.alignTargetFromMeasured('session-1', [1, 2, 3, 4, 5, 6]);
    expect(useRobotSessionStore.getState()).toMatchObject({
      targetPositionsDeg: [1, 2, 3, 4, 5, 6],
      measuredAlignmentPending: false
    });

    useRobotSessionStore.getState().beginHardwareSession('session-2');
    useRobotSessionStore.getState().setJointTarget(0, 12);
    useRobotSessionStore.getState().alignTargetFromMeasured('session-2', [7, 8, 9, 10, 11, 12]);
    expect(useRobotSessionStore.getState().targetPositionsDeg[0]).toBe(12);
  });
});
