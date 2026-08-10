import manifestJson from '@profiles/aethor-robo-dual-7dof/manifest.json';
import { parseRobotProfile } from '../domain/robotProfile';

export const aethorRoboProfile = parseRobotProfile(manifestJson);
export const aethorRoboProfileAssetBase = '/robot-profiles/aethor-robo-dual-7dof';
export const aethorRoboUrdfUrl = `${aethorRoboProfileAssetBase}/${aethorRoboProfile.model.urdfPath}`;

export const aethorRoboJointGroups = aethorRoboProfile.jointGroups ?? [];
