import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import {
  clampJointTargetDeg,
  getJointKeyboardNudgeDeg,
  resolveJointBindings,
  signedRotationDeg
} from './jointInteraction';

describe('joint interaction contract', () => {
  it('resolves all six profile joints by stable URDF name and protocol index', () => {
    const bindings = resolveJointBindings(dummyProfile, [
      'joint_6', 'joint_4', 'joint_2', 'joint_1', 'joint_5', 'joint_3'
    ]);

    expect(bindings).toEqual(dummyProfile.joints.map((joint) => ({
      jointId: joint.jointId,
      urdfJointName: joint.urdfJointName,
      protocolIndex: joint.protocolIndex,
      lowerDeg: joint.lowerDeg,
      upperDeg: joint.upperDeg
    })));
  });

  it('fails closed when a profile joint cannot be found in the URDF', () => {
    expect(() => resolveJointBindings(dummyProfile, ['joint_1', 'joint_2']))
      .toThrow('URDF joint is missing: joint_3');
  });

  it.each(dummyProfile.joints)('clamps $jointId to its declared limits', (joint) => {
    expect(clampJointTargetDeg(dummyProfile, joint.protocolIndex, Number.NEGATIVE_INFINITY)).toBeUndefined();
    expect(clampJointTargetDeg(dummyProfile, joint.protocolIndex, joint.lowerDeg - 100)).toBe(joint.lowerDeg);
    expect(clampJointTargetDeg(dummyProfile, joint.protocolIndex, joint.upperDeg + 100)).toBe(joint.upperDeg);
  });

  it('preserves right-hand-rule rotation direction for any joint axis', () => {
    expect(signedRotationDeg([1, 0, 0], [0, 1, 0], [0, 0, 1])).toBeCloseTo(90);
    expect(signedRotationDeg([0, 1, 0], [0, 0, 1], [1, 0, 0])).toBeCloseTo(90);
    expect(signedRotationDeg([0, 0, 1], [1, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(signedRotationDeg([1, 0, 0], [0, -1, 0], [0, 0, 1])).toBeCloseTo(-90);
  });

  it('uses fine and coarse keyboard increments', () => {
    expect(getJointKeyboardNudgeDeg('ArrowLeft', false)).toBe(-0.1);
    expect(getJointKeyboardNudgeDeg('ArrowUp', true)).toBe(1);
    expect(getJointKeyboardNudgeDeg('Enter', false)).toBeUndefined();
  });
});
