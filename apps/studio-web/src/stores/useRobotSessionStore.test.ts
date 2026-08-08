import { beforeEach, describe, expect, it } from 'vitest';
import { showcaseJointFrame } from '../fixtures/showcase';
import { useRobotSessionStore } from './useRobotSessionStore';

describe('target and feedback isolation', () => {
  beforeEach(() => useRobotSessionStore.getState().resetSession());

  it('edits only the target draft and clamps it to profile limits', () => {
    const feedbackBefore = [...showcaseJointFrame.positionsDeg];
    useRobotSessionStore.getState().setJointTarget(0, 999);
    expect(useRobotSessionStore.getState().targetPositionsDeg[0]).toBe(179.91);
    expect(showcaseJointFrame.positionsDeg).toEqual(feedbackBefore);
  });

  it('clears expert unlock on device-session reset', () => {
    useRobotSessionStore.getState().setTerminalExpertUnlocked(true);
    useRobotSessionStore.getState().resetSession();
    expect(useRobotSessionStore.getState().terminalExpertUnlocked).toBe(false);
  });
});
