import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';
import { isPositionWithinLimits, parseRobotProfile } from './robotProfile';

describe('RobotProfileManifestV1', () => {
  it('accepts the normalized built-in Dummy profile', () => {
    expect(parseRobotProfile(dummyProfile)).toEqual(dummyProfile);
    expect(dummyProfile.joints.map((joint) => joint.urdfJointName)).toEqual([
      'joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6'
    ]);
    expect(dummyProfile.joints.map((joint) => [joint.lowerDeg, joint.upperDeg])).toEqual([
      [-170, 170], [-75, 90], [0, 180], [-180, 180], [-120, 120], [-720, 720]
    ]);
    expect(dummyProfile.joints[2]?.modelTransform).toEqual({ sign: 1, offsetDeg: -90 });
  });

  it('accepts Aethor_robo as two complete seven-axis control groups', () => {
    expect(parseRobotProfile(aethorRoboProfile)).toEqual(aethorRoboProfile);
    expect(aethorRoboProfile.model.dof).toBe(14);
    expect(aethorRoboProfile.jointGroups?.map((group) => group.jointIds.length)).toEqual([7, 7]);
    expect(aethorRoboProfile.capabilities).toMatchObject({
      jointPositionFeedback: false,
      jointGroupCommand: false,
      controlModes: []
    });
  });

  it('rejects unsafe paths, duplicate mappings and mismatched DOF', () => {
    expect(() => parseRobotProfile({ ...dummyProfile, model: { ...dummyProfile.model, urdfPath: '../evil.urdf' } })).toThrow();
    expect(() => parseRobotProfile({ ...dummyProfile, model: { ...dummyProfile.model, dof: 7 } })).toThrow();
    const duplicate = dummyProfile.joints.map((joint, index) => index === 1 ? { ...joint, urdfJointName: 'joint_1' } : joint);
    expect(() => parseRobotProfile({ ...dummyProfile, joints: duplicate })).toThrow();
    expect(() => parseRobotProfile({
      ...dummyProfile,
      capabilities: { ...dummyProfile.capabilities, controlModes: [1, 2, 3, 5] }
    })).toThrow();
    expect(() => parseRobotProfile({ ...dummyProfile, unexpectedOnlineState: true })).toThrow();
    expect(() => parseRobotProfile({
      ...dummyProfile,
      joints: dummyProfile.joints.map((joint, index) => index === 2
        ? { ...joint, modelTransform: { sign: 0, offsetDeg: -90 } }
        : joint)
    })).toThrow();
    expect(() => parseRobotProfile({
      ...aethorRoboProfile,
      jointGroups: aethorRoboProfile.jointGroups?.map((group, index) => index === 1
        ? { ...group, jointIds: [...group.jointIds, 'j1'] }
        : group)
    })).toThrow(/多个控制组/);
  });

  it('validates every joint limit without inferring speed or effort limits', () => {
    expect(isPositionWithinLimits(dummyProfile, [0, 0, 0, 0, 0, 0])).toBe(true);
    expect(isPositionWithinLimits(dummyProfile, [200, 0, 0, 0, 0, 0])).toBe(false);
    expect(isPositionWithinLimits(dummyProfile, [0, 0])).toBe(false);
  });
});
