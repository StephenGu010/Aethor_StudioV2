import manifestJson from '@profiles/dummy-6dof/manifest.json';
import { parseRobotProfile } from '../domain/robotProfile';

export const dummyProfile = parseRobotProfile(manifestJson);
export const dummyProfileAssetBase = '/robot-profiles/dummy-6dof';
export const dummyUrdfUrl = `${dummyProfileAssetBase}/${dummyProfile.model.urdfPath}`;

