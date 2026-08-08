import dummyUrdf from '@profiles/dummy-6dof/model/dummy.urdf?raw';
import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';

const expectedOrigins = [
  { xyz: '0 0 0.087', rpy: '0 0 0' },
  { xyz: '0.035 0 0.0375', rpy: '1.5708 0 -3.1416' },
  { xyz: '0 0.146 0', rpy: '0 0 1.5708' },
  { xyz: '0.052 0 0', rpy: '-1.5708 0 0' },
  { xyz: '0 0 0.117', rpy: '1.5708 0 0' },
  { xyz: '0 0.0625 0', rpy: '-1.5708 0 0' }
] as const;

describe('Dummy URDF kinematic mapping', () => {
  it('keeps all six zero-pose origins, axes and limits aligned with the profile', () => {
    const document = new DOMParser().parseFromString(dummyUrdf, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();

    dummyProfile.joints.forEach((profileJoint, index) => {
      const joint = document.querySelector(`joint[name="${profileJoint.urdfJointName}"]`);
      expect(joint, profileJoint.urdfJointName).not.toBeNull();
      expect(joint?.getAttribute('type')).toBe('revolute');
      expect(joint?.querySelector(':scope > origin')?.getAttribute('xyz')).toBe(expectedOrigins[index]?.xyz);
      expect(joint?.querySelector(':scope > origin')?.getAttribute('rpy')).toBe(expectedOrigins[index]?.rpy);
      expect(joint?.querySelector(':scope > axis')?.getAttribute('xyz')).toBe('0 0 1');

      const limit = joint?.querySelector(':scope > limit');
      const lowerDeg = radiansToDegrees(Number(limit?.getAttribute('lower')));
      const upperDeg = radiansToDegrees(Number(limit?.getAttribute('upper')));
      expect(lowerDeg).toBeCloseTo(profileJoint.lowerDeg, 2);
      expect(upperDeg).toBeCloseTo(profileJoint.upperDeg, 2);
    });
  });
});

function radiansToDegrees(value: number) {
  return value * 180 / Math.PI;
}
