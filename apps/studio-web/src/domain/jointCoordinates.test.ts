import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import { deviceAngleToModelDeg, modelAngleToDeviceDeg } from './jointCoordinates';

describe('Dummy device/model joint coordinates', () => {
  it('uses #GETJPOS coordinates as the canonical UI and command values', () => {
    const j3 = dummyProfile.joints[2]!;
    expect(deviceAngleToModelDeg(j3, 0)).toBe(-90);
    expect(deviceAngleToModelDeg(j3, 90)).toBe(0);
    expect(deviceAngleToModelDeg(j3, 180)).toBe(90);
    expect(modelAngleToDeviceDeg(j3, 0)).toBe(90);
  });

  it('round-trips every declared device limit through the model transform', () => {
    dummyProfile.joints.forEach((joint) => {
      for (const deviceDeg of [joint.lowerDeg, 0, joint.upperDeg]) {
        expect(modelAngleToDeviceDeg(joint, deviceAngleToModelDeg(joint, deviceDeg)))
          .toBeCloseTo(deviceDeg, 8);
      }
    });
  });
});
