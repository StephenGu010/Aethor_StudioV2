import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import { isPositionWithinLimits, parseRobotProfile } from './robotProfile';

describe('RobotProfileManifestV1', () => {
  it('accepts the normalized built-in Dummy profile', () => {
    expect(parseRobotProfile(dummyProfile)).toEqual(dummyProfile);
    expect(dummyProfile.joints.map((joint) => joint.urdfJointName)).toEqual([
      'joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6'
    ]);
  });

  it('rejects unsafe paths, duplicate mappings and mismatched DOF', () => {
    expect(() => parseRobotProfile({ ...dummyProfile, model: { ...dummyProfile.model, urdfPath: '../evil.urdf' } })).toThrow();
    expect(() => parseRobotProfile({ ...dummyProfile, model: { ...dummyProfile.model, dof: 7 } })).toThrow();
    const duplicate = dummyProfile.joints.map((joint, index) => index === 1 ? { ...joint, urdfJointName: 'joint_1' } : joint);
    expect(() => parseRobotProfile({ ...dummyProfile, joints: duplicate })).toThrow();
  });

  it('validates every joint limit without inferring speed or effort limits', () => {
    expect(isPositionWithinLimits(dummyProfile, [0, 0, 0, 0, 0, 0])).toBe(true);
    expect(isPositionWithinLimits(dummyProfile, [200, 0, 0, 0, 0, 0])).toBe(false);
    expect(isPositionWithinLimits(dummyProfile, [0, 0])).toBe(false);
  });
});
