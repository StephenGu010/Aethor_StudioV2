import { beforeEach, describe, expect, it } from 'vitest';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';
import { dummyProfile } from '../profile/dummyProfile';
import { useAethorRoboConsoleStore } from './useAethorRoboConsoleStore';
import { useGatewayRuntimeStore } from './useGatewayRuntimeStore';
import { useRobotSessionStore } from './useRobotSessionStore';
import { useActiveRobotProfileStore } from './useActiveRobotProfileStore';

describe('active robot profile session', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
    useAethorRoboConsoleStore.getState().resetPreview();
    useActiveRobotProfileStore.setState({ activeProfileId: aethorRoboProfile.profileId });
  });

  it('resets robot-specific draft intent on profile switch', () => {
    useRobotSessionStore.getState().setJointTarget(0, 25);
    useAethorRoboConsoleStore.getState().setJointTarget(0, 40);

    const result = useActiveRobotProfileStore.getState().switchProfile(dummyProfile.profileId);

    expect(result).toEqual({ switched: true, reason: null });
    expect(useActiveRobotProfileStore.getState().activeProfileId).toBe(dummyProfile.profileId);
    expect(useRobotSessionStore.getState()).toMatchObject({
      targetPositionsDeg: dummyProfile.model.showcasePoseDeg
    });
    expect(useAethorRoboConsoleStore.getState().targetPositionsDeg).toEqual(aethorRoboProfile.model.showcasePoseDeg);
    expect(window.sessionStorage.getItem('aethor.active-profile.v1')).toBe(dummyProfile.profileId);
  });

  it('refuses to hide a connected Dummy hardware session', () => {
    useActiveRobotProfileStore.setState({ activeProfileId: dummyProfile.profileId });
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1',
      profileId: dummyProfile.profileId,
      connectionState: 'connected',
      motorState: 'disabled',
      controlMode: 2,
      timestampUtc: '2026-08-10T00:00:00.000Z',
      source: 'measured',
      validity: 'valid'
    });

    const result = useActiveRobotProfileStore.getState().switchProfile(aethorRoboProfile.profileId);

    expect(result.switched).toBe(false);
    expect(result.reason).toContain('断开连接');
    expect(useActiveRobotProfileStore.getState().activeProfileId).toBe(dummyProfile.profileId);
  });
});
