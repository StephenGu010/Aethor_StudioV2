import {
  AETHOR_ARM_MOTOR_IDS,
  type AethorArmMotorFrameV1,
  type AethorArmMotorId,
  type AethorArmMotorSampleV1,
  type RobotProfileManifestV1
} from '@aethor/contracts';

export type { AethorArmMotorFrameV1 } from '@aethor/contracts';
export type AethorArmJointAvailability =
  | 'notObserved'
  | 'present'
  | 'stale'
  | 'missing'
  | 'conflict';

export interface AethorArmJointState {
  motorId: AethorArmMotorId;
  jointId: string;
  protocolIndex: number;
  availability: AethorArmJointAvailability;
  feedbackAgeMs: number | null;
}

export interface AethorArmMotorSnapshot {
  bootId: string | null;
  armId: string | null;
  frameSeq: number | null;
  receivedAtUtc: string | null;
  actualPositionsDeg: readonly number[];
  joints: readonly AethorArmJointState[];
  duplicateMotorIds: readonly number[];
  unexpectedMotorIds: readonly number[];
  degradedJointIds: readonly string[];
  ignoredFrameCount: number;
}

export function createAethorArmMotorSnapshot(
  profile: RobotProfileManifestV1,
  groupId: string,
  initialPositionsDeg: readonly number[]
): AethorArmMotorSnapshot {
  const joints = getSevenAxisGroupJoints(profile, groupId);
  return {
    bootId: null,
    armId: null,
    frameSeq: null,
    receivedAtUtc: null,
    actualPositionsDeg: normalizePositions(profile.model.dof, initialPositionsDeg),
    joints: joints.map((joint, index) => ({
      motorId: AETHOR_ARM_MOTOR_IDS[index]!,
      jointId: joint.jointId,
      protocolIndex: joint.protocolIndex,
      availability: 'notObserved',
      feedbackAgeMs: null
    })),
    duplicateMotorIds: [],
    unexpectedMotorIds: [],
    degradedJointIds: [],
    ignoredFrameCount: 0
  };
}

export function applyAethorArmMotorFrame(
  profile: RobotProfileManifestV1,
  previous: AethorArmMotorSnapshot,
  frame: AethorArmMotorFrameV1
): AethorArmMotorSnapshot {
  const groupId = frame.jointGroupId;
  const groupJoints = getSevenAxisGroupJoints(profile, groupId);
  if (frame.bootId === previous.bootId
    && previous.frameSeq !== null
    && frame.frameSeq <= previous.frameSeq) {
    return { ...previous, ignoredFrameCount: previous.ignoredFrameCount + 1 };
  }

  const samplesById = new Map<number, AethorArmMotorSampleV1[]>();
  frame.motors.forEach((sample) => {
    const samples = samplesById.get(sample.motorId) ?? [];
    samples.push(sample);
    samplesById.set(sample.motorId, samples);
  });

  const duplicateMotorIds = [...samplesById.entries()]
    .filter(([, samples]) => samples.length > 1)
    .map(([motorId]) => motorId)
    .sort(compareNumbers);
  const unexpectedMotorIds = [...samplesById.keys()]
    .filter((motorId) => !isAethorArmMotorId(motorId))
    .sort(compareNumbers);
  const duplicateSet = new Set(duplicateMotorIds);
  const actualPositionsDeg = [...previous.actualPositionsDeg];

  const joints = groupJoints.map((joint, index): AethorArmJointState => {
    const motorId = AETHOR_ARM_MOTOR_IDS[index]!;
    const samples = samplesById.get(motorId) ?? [];
    if (duplicateSet.has(motorId)) {
      return {
        motorId,
        jointId: joint.jointId,
        protocolIndex: joint.protocolIndex,
        availability: 'conflict',
        feedbackAgeMs: minimumFiniteAge(samples)
      };
    }
    const sample = samples[0];
    if (!sample) {
      const prior = previous.joints.find((candidate) => candidate.motorId === motorId);
      return {
        motorId,
        jointId: joint.jointId,
        protocolIndex: joint.protocolIndex,
        availability: frame.snapshotComplete ? 'missing' : (prior?.availability ?? 'notObserved'),
        feedbackAgeMs: frame.snapshotComplete ? null : (prior?.feedbackAgeMs ?? null)
      };
    }
    const valid = sample.valid
      && Number.isFinite(sample.positionDeg)
      && Number.isFinite(sample.feedbackAgeMs)
      && sample.feedbackAgeMs >= 0;
    if (valid) actualPositionsDeg[joint.protocolIndex] = sample.positionDeg;
    return {
      motorId,
      jointId: joint.jointId,
      protocolIndex: joint.protocolIndex,
      availability: valid ? 'present' : 'stale',
      feedbackAgeMs: Number.isFinite(sample.feedbackAgeMs) && sample.feedbackAgeMs >= 0
        ? sample.feedbackAgeMs
        : null
    };
  });

  const firstUncertainIndex = joints.findIndex((joint) => joint.availability !== 'present');
  const degradedJointIds = firstUncertainIndex < 0
    ? []
    : joints.slice(firstUncertainIndex).map((joint) => joint.jointId);

  return {
    bootId: frame.bootId,
    armId: frame.armId,
    frameSeq: frame.frameSeq,
    receivedAtUtc: frame.receivedAtUtc,
    actualPositionsDeg,
    joints,
    duplicateMotorIds,
    unexpectedMotorIds,
    degradedJointIds,
    ignoredFrameCount: previous.ignoredFrameCount
  };
}

function getSevenAxisGroupJoints(profile: RobotProfileManifestV1, groupId: string) {
  const group = profile.jointGroups?.find((candidate) => candidate.groupId === groupId);
  if (!group || group.jointIds.length !== AETHOR_ARM_MOTOR_IDS.length) {
    throw new Error(`Aethor arm group ${groupId} must declare exactly seven joints`);
  }
  const jointsById = new Map(profile.joints.map((joint) => [joint.jointId, joint]));
  return group.jointIds.map((jointId) => {
    const joint = jointsById.get(jointId);
    if (!joint) throw new Error(`Aethor arm group ${groupId} references unknown joint ${jointId}`);
    return joint;
  });
}

function normalizePositions(dof: number, positionsDeg: readonly number[]) {
  return Array.from({ length: dof }, (_, index) => {
    const value = positionsDeg[index];
    return value !== undefined && Number.isFinite(value) ? value : 0;
  });
}

function minimumFiniteAge(samples: readonly AethorArmMotorSampleV1[]) {
  const ages = samples
    .map((sample) => sample.feedbackAgeMs)
    .filter((age) => Number.isFinite(age) && age >= 0);
  return ages.length > 0 ? Math.min(...ages) : null;
}

function isAethorArmMotorId(value: number): value is AethorArmMotorId {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

function compareNumbers(left: number, right: number) {
  return left - right;
}
