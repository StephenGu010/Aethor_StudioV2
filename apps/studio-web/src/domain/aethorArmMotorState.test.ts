import { describe, expect, it } from 'vitest';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';
import {
  applyAethorArmMotorFrame,
  createAethorArmMotorSnapshot,
  expireAethorArmMotorSnapshot,
  type AethorArmMotorFrameV1
} from './aethorArmMotorState';

const initial = Array(aethorRoboProfile.model.dof).fill(0);

describe('Aethor arm motor-id mapping', () => {
  it('maps an arbitrary subset and arrival order by motor id', () => {
    const snapshot = applyAethorArmMotorFrame(
      aethorRoboProfile,
      createAethorArmMotorSnapshot(aethorRoboProfile, 'left-arm', initial),
      frame([
        { motorId: 7, positionDeg: 70, feedbackAgeMs: 2, valid: true },
        { motorId: 2, positionDeg: 20, feedbackAgeMs: 3, valid: true },
        { motorId: 5, positionDeg: 50, feedbackAgeMs: 4, valid: true }
      ])
    );

    expect(snapshot.actualPositionsDeg.slice(0, 7)).toEqual([0, 20, 0, 0, 50, 0, 70]);
    expect(snapshot.joints.map((joint) => joint.availability)).toEqual([
      'missing', 'present', 'missing', 'missing', 'present', 'missing', 'present'
    ]);
    expect(snapshot.degradedJointIds).toEqual(['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7']);
  });

  it('quarantines duplicate and out-of-range ids without applying ambiguous positions', () => {
    const snapshot = applyAethorArmMotorFrame(
      aethorRoboProfile,
      createAethorArmMotorSnapshot(aethorRoboProfile, 'right-arm', initial),
      frame([
        { motorId: 3, positionDeg: 31, feedbackAgeMs: 1, valid: true },
        { motorId: 3, positionDeg: 32, feedbackAgeMs: 1, valid: true },
        { motorId: 8, positionDeg: 80, feedbackAgeMs: 1, valid: true },
        { motorId: 12, positionDeg: 120, feedbackAgeMs: 1, valid: true }
      ], { jointGroupId: 'right-arm', armId: 'arm-02' })
    );

    expect(snapshot.duplicateMotorIds).toEqual([3]);
    expect(snapshot.unexpectedMotorIds).toEqual([8, 12]);
    expect(snapshot.joints[2]?.availability).toBe('conflict');
    expect(snapshot.actualPositionsDeg[9]).toBe(0);
  });

  it('preserves conflict-mask and unexpected-id evidence from the firmware projection', () => {
    const snapshot = applyAethorArmMotorFrame(
      aethorRoboProfile,
      createAethorArmMotorSnapshot(aethorRoboProfile, 'left-arm', initial),
      frame([
        {
          motorId: 4,
          positionDeg: 44,
          feedbackAgeMs: 65535,
          valid: false,
          identityConflict: true
        }
      ], { unexpectedMotorIds: [8, 9] })
    );

    expect(snapshot.duplicateMotorIds).toEqual([4]);
    expect(snapshot.unexpectedMotorIds).toEqual([8, 9]);
    expect(snapshot.joints[3]?.availability).toBe('conflict');
    expect(snapshot.actualPositionsDeg[3]).toBe(0);
  });

  it('ignores reordered frames within one boot but accepts a controller reboot', () => {
    const start = createAethorArmMotorSnapshot(aethorRoboProfile, 'left-arm', initial);
    const newest = applyAethorArmMotorFrame(aethorRoboProfile, start, frame([
      { motorId: 1, positionDeg: 10, feedbackAgeMs: 1, valid: true }
    ], { frameSeq: 9 }));
    const old = applyAethorArmMotorFrame(aethorRoboProfile, newest, frame([
      { motorId: 1, positionDeg: 2, feedbackAgeMs: 1, valid: true }
    ], { frameSeq: 8 }));
    const rebooted = applyAethorArmMotorFrame(aethorRoboProfile, old, frame([
      { motorId: 1, positionDeg: 3, feedbackAgeMs: 1, valid: true }
    ], { bootId: 'boot-2', frameSeq: 1 }));

    expect(old.actualPositionsDeg[0]).toBe(10);
    expect(old.ignoredFrameCount).toBe(1);
    expect(rebooted.actualPositionsDeg[0]).toBe(3);
  });

  it('preserves prior availability for an explicitly incremental frame', () => {
    const start = applyAethorArmMotorFrame(
      aethorRoboProfile,
      createAethorArmMotorSnapshot(aethorRoboProfile, 'left-arm', initial),
      frame([{ motorId: 1, positionDeg: 10, feedbackAgeMs: 1, valid: true }])
    );
    const incremental = applyAethorArmMotorFrame(
      aethorRoboProfile,
      start,
      frame([{ motorId: 2, positionDeg: 20, feedbackAgeMs: 1, valid: true }], {
        frameSeq: 2,
        snapshotComplete: false
      })
    );

    expect(incremental.joints[0]?.availability).toBe('present');
    expect(incremental.actualPositionsDeg.slice(0, 2)).toEqual([10, 20]);
  });

  it('retains the last position while expiring present feedback after a stall', () => {
    const applied = applyAethorArmMotorFrame(
      aethorRoboProfile,
      createAethorArmMotorSnapshot(aethorRoboProfile, 'left-arm', initial),
      frame([{ motorId: 1, positionDeg: 27, feedbackAgeMs: 1, valid: true }]),
      1_000
    );

    expect(expireAethorArmMotorSnapshot(applied, 1_248, 250)).toBe(applied);
    const expired = expireAethorArmMotorSnapshot(applied, 1_249, 250);
    expect(expired.actualPositionsDeg[0]).toBe(27);
    expect(expired.joints[0]?.availability).toBe('stale');
    expect(expired.degradedJointIds).toEqual(expired.joints.map((joint) => joint.jointId));
  });

  it('expires an old joint even while incremental frames keep another joint fresh', () => {
    const first = applyAethorArmMotorFrame(
      aethorRoboProfile,
      createAethorArmMotorSnapshot(aethorRoboProfile, 'left-arm', initial),
      frame([{ motorId: 1, positionDeg: 10, feedbackAgeMs: 1, valid: true }], { snapshotComplete: false }),
      1_000
    );
    const second = applyAethorArmMotorFrame(
      aethorRoboProfile,
      first,
      frame([{ motorId: 2, positionDeg: 20, feedbackAgeMs: 1, valid: true }], {
        frameSeq: 2,
        snapshotComplete: false
      }),
      1_240
    );

    const expired = expireAethorArmMotorSnapshot(second, 1_251, 250);
    expect(expired.joints[0]?.availability).toBe('stale');
    expect(expired.joints[1]?.availability).toBe('present');
  });
});

function frame(
  motors: AethorArmMotorFrameV1['motors'],
  overrides: Partial<AethorArmMotorFrameV1> = {}
): AethorArmMotorFrameV1 {
  return {
    contractVersion: '1.0',
    profileId: 'aethor-robo-dual-7dof',
    jointGroupId: 'left-arm',
    controllerId: 'aethor-controller-01',
    bootId: 'boot-1',
    armId: 'arm-01',
    frameSeq: 1,
    receivedAtUtc: '2026-08-12T12:00:00.000Z',
    snapshotComplete: true,
    motors,
    ...overrides
  };
}
