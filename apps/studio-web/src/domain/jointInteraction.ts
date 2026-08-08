import type { RobotProfileManifestV1 } from '@aethor/contracts';

export type Vector3Tuple = readonly [number, number, number];

export interface JointBinding {
  jointId: string;
  urdfJointName: string;
  protocolIndex: number;
  lowerDeg: number;
  upperDeg: number;
}

export function resolveJointBindings(
  profile: RobotProfileManifestV1,
  availableUrdfJointNames: Iterable<string>
): JointBinding[] {
  const available = new Set(availableUrdfJointNames);
  const seenJointNames = new Set<string>();
  const seenProtocolIndices = new Set<number>();

  return profile.joints.map((joint) => {
    if (seenJointNames.has(joint.urdfJointName)) {
      throw new Error(`Duplicate URDF joint mapping: ${joint.urdfJointName}`);
    }
    if (seenProtocolIndices.has(joint.protocolIndex)) {
      throw new Error(`Duplicate protocol index mapping: ${joint.protocolIndex}`);
    }
    if (!available.has(joint.urdfJointName)) {
      throw new Error(`URDF joint is missing: ${joint.urdfJointName}`);
    }
    seenJointNames.add(joint.urdfJointName);
    seenProtocolIndices.add(joint.protocolIndex);
    return {
      jointId: joint.jointId,
      urdfJointName: joint.urdfJointName,
      protocolIndex: joint.protocolIndex,
      lowerDeg: joint.lowerDeg,
      upperDeg: joint.upperDeg
    };
  });
}

export function clampJointTargetDeg(
  profile: RobotProfileManifestV1,
  protocolIndex: number,
  valueDeg: number
): number | undefined {
  const joint = profile.joints.find((candidate) => candidate.protocolIndex === protocolIndex);
  if (!joint || !Number.isFinite(valueDeg)) return undefined;
  return Math.min(joint.upperDeg, Math.max(joint.lowerDeg, valueDeg));
}

export function getJointKeyboardNudgeDeg(key: string, shiftKey: boolean): number | undefined {
  const magnitude = shiftKey ? 1 : 0.1;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return -magnitude;
  if (key === 'ArrowRight' || key === 'ArrowUp') return magnitude;
  return undefined;
}

export function signedRotationDeg(
  startVector: Vector3Tuple,
  currentVector: Vector3Tuple,
  axis: Vector3Tuple
): number | undefined {
  const normalizedAxis = normalize(axis);
  if (!normalizedAxis) return undefined;
  const start = normalize(projectOntoPlane(startVector, normalizedAxis));
  const current = normalize(projectOntoPlane(currentVector, normalizedAxis));
  if (!start || !current) return undefined;
  const numerator = dot(normalizedAxis, cross(start, current));
  const denominator = clamp(dot(start, current), -1, 1);
  return radiansToDegrees(Math.atan2(numerator, denominator));
}

function projectOntoPlane(vector: Vector3Tuple, normal: Vector3Tuple): Vector3Tuple {
  const component = dot(vector, normal);
  return [
    vector[0] - normal[0] * component,
    vector[1] - normal[1] * component,
    vector[2] - normal[2] * component
  ];
}

function normalize(vector: Vector3Tuple): Vector3Tuple | undefined {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-8) return undefined;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function dot(left: Vector3Tuple, right: Vector3Tuple) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function radiansToDegrees(value: number) {
  return value * 180 / Math.PI;
}
