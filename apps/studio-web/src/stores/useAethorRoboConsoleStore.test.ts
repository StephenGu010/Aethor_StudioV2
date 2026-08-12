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
    expect(useAethorRoboConsoleStore.getState().motorSnapshots).toEqual({});
  });

  it('merges independently ordered motor-id frames from both arms', () => {
    const state = useAethorRoboConsoleStore.getState();
    state.applyMotorFrame(frame('left-arm', 'arm-01', [
      { motorId: 4, positionDeg: 44, feedbackAgeMs: 2, valid: true },
      { motorId: 1, positionDeg: 11, feedbackAgeMs: 2, valid: true }
    ]));
    useAethorRoboConsoleStore.getState().applyMotorFrame(frame('right-arm', 'arm-02', [
      { motorId: 7, positionDeg: 177, feedbackAgeMs: 2, valid: true },
      { motorId: 2, positionDeg: 122, feedbackAgeMs: 2, valid: true }
    ]));

    const next = useAethorRoboConsoleStore.getState();
    expect(next.actualPositionsDeg[0]).toBe(11);
    expect(next.actualPositionsDeg[3]).toBe(44);
    expect(next.actualPositionsDeg[8]).toBe(122);
    expect(next.actualPositionsDeg[13]).toBe(177);
    expect(Object.keys(next.motorSnapshots)).toEqual(['left-arm', 'right-arm']);
  });

  it('clears feedback, diagnostics, and pose together on session reset', () => {
    useAethorRoboConsoleStore.getState().applyMotorFrame(frame('left-arm', 'arm-01', [
      { motorId: 1, positionDeg: 25, feedbackAgeMs: 2, valid: true }
    ]));
    useAethorRoboConsoleStore.getState().clearMotorTelemetry();

    expect(useAethorRoboConsoleStore.getState().actualPositionsDeg).toEqual(
      aethorRoboProfile.model.showcasePoseDeg
    );
    expect(useAethorRoboConsoleStore.getState().motorSnapshots).toEqual({});
  });
});

function frame(jointGroupId: 'left-arm' | 'right-arm', armId: string, motors: Array<{
  motorId: number;
  positionDeg: number;
  feedbackAgeMs: number;
  valid: boolean;
}>) {
  return {
    contractVersion: '1.0' as const,
    profileId: 'aethor-robo-dual-7dof' as const,
    jointGroupId,
    controllerId: `aethor-controller-${armId.slice(-2)}`,
    bootId: `${armId}-boot-1`,
    armId,
    frameSeq: 1,
    receivedAtUtc: '2026-08-12T12:00:00.000Z',
    snapshotComplete: true,
    motors
  };
}
