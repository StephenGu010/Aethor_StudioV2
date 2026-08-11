import type { RobotJointProfile } from '@aethor/contracts';

/**
 * Converts the canonical device angle reported by #GETJPOS into the URDF
 * joint coordinate. Device angles remain authoritative everywhere else.
 */
export function deviceAngleToModelDeg(joint: RobotJointProfile, deviceDeg: number): number {
  const transform = joint.modelTransform;
  return transform ? deviceDeg * transform.sign + transform.offsetDeg : deviceDeg;
}

/** Converts a URDF/model joint coordinate back into the device protocol coordinate. */
export function modelAngleToDeviceDeg(joint: RobotJointProfile, modelDeg: number): number {
  const transform = joint.modelTransform;
  return transform ? (modelDeg - transform.offsetDeg) / transform.sign : modelDeg;
}
