import type { RobotProfileManifestV1 } from '@aethor/contracts';
import { aethorRoboProfile } from './aethorRoboProfile';
import { dummyProfile } from './dummyProfile';

export const robotProfileIds = [dummyProfile.profileId, aethorRoboProfile.profileId] as const;

export type RobotProfileId = (typeof robotProfileIds)[number];

export interface RobotProfileOption {
  profile: RobotProfileManifestV1;
  summary: string;
  availability: string;
  hardwareReady: boolean;
}

export const robotProfileOptions: readonly RobotProfileOption[] = [
  {
    profile: dummyProfile,
    summary: '6-DOF · Dummy ASCII v1',
    availability: 'Hardware gateway available',
    hardwareReady: true
  },
  {
    profile: aethorRoboProfile,
    summary: '2 × 7-DOF · local FK preview',
    availability: 'Protocol pending',
    hardwareReady: false
  }
];

export function isRobotProfileId(value: string): value is RobotProfileId {
  return robotProfileIds.some((profileId) => profileId === value);
}

export function getRobotProfileOption(profileId: RobotProfileId) {
  return robotProfileOptions.find((option) => option.profile.profileId === profileId)!;
}
