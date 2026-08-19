import type { DummyControlMode } from './types';
import { DEFAULT_DUMMY_JOINT_SPEED_DEG_S } from './dummyAsciiV1';

export type ActionProgramSourceV1 = 'authored' | 'showcaseExample';
export type ActionWaypointSourceV1 = 'manual' | 'measuredCapture' | 'showcaseExample';

export const DEFAULT_ACTION_PROGRAM_SPEED_DEG_S = DEFAULT_DUMMY_JOINT_SPEED_DEG_S;

export type ActionPostArrivalWaitV1 =
  | { kind: 'none' }
  | { kind: 'durationAfterConfirmed'; durationMs: number };

export interface ActionWaypointV1 {
  waypointId: string;
  name: string;
  positionsDeg: number[];
  mode: DummyControlMode;
  postArrivalWait: ActionPostArrivalWaitV1;
  notes: string;
  source: ActionWaypointSourceV1;
  capturedAtUtc: string | null;
}

export interface ActionProgramV1 {
  schemaVersion: '1.0';
  programId: string;
  name: string;
  revision: number;
  profileId: 'dummy-6dof';
  jointCoordinateSystem: 'dummy-device-joints-v1';
  createdAtUtc: string;
  updatedAtUtc: string;
  source: ActionProgramSourceV1;
  speedDegS: number;
  loopEnabled: boolean;
  notes: string;
  waypoints: ActionWaypointV1[];
}
