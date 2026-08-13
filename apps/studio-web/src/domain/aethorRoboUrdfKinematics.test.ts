import aethorRoboUrdf from '@profiles/aethor-robo-dual-7dof/model/aethor_robo.urdf?raw';
import { describe, expect, it } from 'vitest';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';

const expectedJointNames = [
  'left_arm_joint_1',
  'left_arm_joint_2',
  'left_arm_joint_3',
  'left_arm_joint_4',
  'left_arm_joint_5',
  'left_arm_joint_6',
  'left_arm_joint_7',
  'right_arm_joint_1',
  'right_arm_joint_2',
  'right_arm_joint_3',
  'right_arm_joint_4',
  'right_arm_joint_5',
  'right_arm_joint_6',
  'right_arm_joint_7'
] as const;

const expectedAxes = [
  '0 0 1', '0 0 1', '0 0 -1', '0 0 1', '0 0 -1', '0 0 -1', '0 0 -1',
  '0 0 1', '0 0 -1', '0 0 -1', '0 0 -1', '0 0 -1', '0 0 -1', '0 0 -1'
] as const;

describe('Aethor_robo deployed URDF mapping', () => {
  it('keeps the stable fourteen-joint Profile mapping and omits the momentum-wheel chain', () => {
    const document = new DOMParser().parseFromString(aethorRoboUrdf, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.documentElement.getAttribute('name')).toBe('aethor_robo');
    expect([...document.querySelectorAll('link')]).toHaveLength(17);
    expect([...document.querySelectorAll('joint')]).toHaveLength(16);
    expect([...document.querySelectorAll('joint[type="revolute"]')]).toHaveLength(14);
    expect([...document.querySelectorAll('joint[type="fixed"]')]).toHaveLength(2);
    expect(document.querySelector('joint[type="continuous"]')).toBeNull();
    expect(aethorRoboUrdf.toLowerCase()).not.toContain('wheel_');

    expect(aethorRoboProfile.joints.map((joint) => joint.urdfJointName)).toEqual(expectedJointNames);
    expect(aethorRoboProfile.joints.map((joint) => joint.protocolIndex)).toEqual(
      Array.from({ length: 14 }, (_, index) => index)
    );

    aethorRoboProfile.joints.forEach((profileJoint, index) => {
      const joint = document.querySelector(`joint[name="${profileJoint.urdfJointName}"]`);
      expect(joint, profileJoint.urdfJointName).not.toBeNull();
      expect(joint?.getAttribute('type')).toBe('revolute');
      expect(joint?.querySelector(':scope > axis')?.getAttribute('xyz')).toBe(expectedAxes[index]);
      expect(radiansToDegrees(Number(joint?.querySelector(':scope > limit')?.getAttribute('lower'))))
        .toBeCloseTo(profileJoint.lowerDeg, 2);
      expect(radiansToDegrees(Number(joint?.querySelector(':scope > limit')?.getAttribute('upper'))))
        .toBeCloseTo(profileJoint.upperDeg, 2);
    });
  });

  it('retains the established zero convention on both first arm joints', () => {
    const document = new DOMParser().parseFromString(aethorRoboUrdf, 'application/xml');
    for (const jointName of ['left_arm_joint_1', 'right_arm_joint_1']) {
      const joint = document.querySelector(`joint[name="${jointName}"]`);
      expect(joint?.querySelector(':scope > origin')?.getAttribute('rpy')).toBe('0 0 0');
      expect(joint?.querySelector(':scope > limit')?.getAttribute('lower')).toBe('0');
      expect(joint?.querySelector(':scope > limit')?.getAttribute('upper')).toBe('6.2832');
    }
  });
});

function radiansToDegrees(value: number) {
  return value * 180 / Math.PI;
}
