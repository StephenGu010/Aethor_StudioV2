import { beforeEach, describe, expect, it } from 'vitest';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';
import { useAethorRoboConsoleStore } from './useAethorRoboConsoleStore';

describe('Aethor_robo console target isolation', () => {
  beforeEach(() => useAethorRoboConsoleStore.getState().resetPreview());

  it('owns fourteen local-preview targets split into two seven-axis groups', () => {
    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg).toHaveLength(14);
    expect(aethorRoboProfile.jointGroups?.map((group) => group.jointIds.length)).toEqual([7, 7]);
  });

  it('clamps preview edits without creating hardware feedback', () => {
    useAethorRoboConsoleStore.getState().setJointTarget(8, 999);
    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg[8]).toBe(360);
  });
});
