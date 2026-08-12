export const AETHOR_ARM_MOTOR_IDS = [1, 2, 3, 4, 5, 6, 7] as const;

export type AethorArmMotorId = (typeof AETHOR_ARM_MOTOR_IDS)[number];
export type AethorArmJointGroupId = 'left-arm' | 'right-arm';

/** Raw, identity-bearing observation emitted by the Aethor adapter. */
export interface AethorArmMotorSampleV1 {
  motorId: number;
  positionDeg: number;
  feedbackAgeMs: number;
  valid: boolean;
}

/**
 * Gateway-to-client commissioning frame. Samples may be a subset and may be
 * unordered. Duplicate and out-of-range IDs are intentionally preserved so
 * the consumer can quarantine and diagnose them instead of silently remapping.
 */
export interface AethorArmMotorFrameV1 {
  contractVersion: '1.0';
  profileId: 'aethor-robo-dual-7dof';
  jointGroupId: AethorArmJointGroupId;
  controllerId: string;
  armId: string;
  bootId: string;
  frameSeq: number;
  receivedAtUtc: string;
  snapshotComplete: boolean;
  motors: readonly AethorArmMotorSampleV1[];
}
