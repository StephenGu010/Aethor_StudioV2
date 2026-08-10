import { create } from 'zustand';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';
import { dummyProfile } from '../profile/dummyProfile';
import { isRobotProfileId, type RobotProfileId } from '../profile/profileCatalog';
import { useAethorRoboConsoleStore } from './useAethorRoboConsoleStore';
import { useGatewayRuntimeStore } from './useGatewayRuntimeStore';
import { useRobotSessionStore } from './useRobotSessionStore';

const PROFILE_SESSION_KEY = 'aethor.active-profile.v1';

export interface RobotProfileSwitchResult {
  switched: boolean;
  reason: string | null;
}

interface ActiveRobotProfileState {
  activeProfileId: RobotProfileId;
  switchProfile: (nextProfileId: RobotProfileId) => RobotProfileSwitchResult;
}

export const useActiveRobotProfileStore = create<ActiveRobotProfileState>((set, get) => ({
  activeProfileId: readInitialProfileId(),
  switchProfile: (nextProfileId) => {
    const currentProfileId = get().activeProfileId;
    if (nextProfileId === currentProfileId) return { switched: false, reason: null };

    const reason = getRobotProfileSwitchBlockReason(currentProfileId, nextProfileId);
    if (reason) return { switched: false, reason };

    // Profile changes are safety boundaries: hidden target intent and expert access
    // must never survive into a different robot context.
    useRobotSessionStore.getState().resetSession(dummyProfile.profileId);
    useAethorRoboConsoleStore.getState().resetPreview();
    useGatewayRuntimeStore.getState().resetRuntime();
    set({ activeProfileId: nextProfileId });
    writeProfileId(nextProfileId);
    return { switched: true, reason: null };
  }
}));

export function getRobotProfileSwitchBlockReason(
  currentProfileId: RobotProfileId,
  nextProfileId: RobotProfileId
) {
  if (currentProfileId === nextProfileId || currentProfileId !== dummyProfile.profileId) return null;

  const runtime = useGatewayRuntimeStore.getState();
  if (runtime.latchedSafetyResult) {
    return 'Dummy 存在未解除的命令安全联锁；请先执行停止并去使能，并现场确认设备状态。';
  }
  if (runtime.session.connectionState !== 'offline') {
    return 'Dummy 会话仍占用或可能占用串口；请先确认电机已去使能，再到“设备与模型”断开连接。';
  }
  if (runtime.session.source === 'measured' && runtime.session.motorState !== 'disabled') {
    return 'Dummy 电机状态未明确确认去使能，禁止隐藏该硬件会话。';
  }
  return null;
}

function readInitialProfileId(): RobotProfileId {
  if (typeof window === 'undefined') return aethorRoboProfile.profileId;
  try {
    const stored = window.sessionStorage.getItem(PROFILE_SESSION_KEY);
    return stored && isRobotProfileId(stored) ? stored : aethorRoboProfile.profileId;
  } catch {
    return aethorRoboProfile.profileId;
  }
}

function writeProfileId(profileId: RobotProfileId) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PROFILE_SESSION_KEY, profileId);
  } catch {
    // Session storage is a convenience only; the in-memory selection remains authoritative.
  }
}
