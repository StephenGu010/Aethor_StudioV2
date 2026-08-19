import { create } from 'zustand';
import { clampJointTargetDeg } from '../domain/jointInteraction';
import { dummyProfile } from '../profile/dummyProfile';

interface RobotSessionState {
  profileId: string;
  targetPositionsDeg: number[];
  hardwareSessionId: string | null;
  measuredAlignmentPending: boolean;
  setJointTarget: (protocolIndex: number, valueDeg: number) => void;
  alignTarget: (positionsDeg: number[]) => void;
  loadActionPreview: (positionsDeg: readonly number[]) => boolean;
  loadShowcasePose: () => void;
  beginHardwareSession: (sessionId: string) => void;
  alignTargetFromMeasured: (sessionId: string, positionsDeg: number[]) => void;
  endHardwareSession: () => void;
  resetSession: (profileId?: string) => void;
}

const defaultTargets = () => [...(dummyProfile.model.showcasePoseDeg ?? Array(dummyProfile.model.dof).fill(0))];

export const useRobotSessionStore = create<RobotSessionState>((set) => ({
  profileId: dummyProfile.profileId,
  targetPositionsDeg: defaultTargets(),
  hardwareSessionId: null,
  measuredAlignmentPending: false,
  setJointTarget: (protocolIndex, valueDeg) =>
    set((state) => {
      const clampedValue = clampJointTargetDeg(dummyProfile, protocolIndex, valueDeg);
      if (clampedValue === undefined) return state;
      const targetPositionsDeg = [...state.targetPositionsDeg];
      targetPositionsDeg[protocolIndex] = clampedValue;
      return { targetPositionsDeg, measuredAlignmentPending: false };
    }),
  alignTarget: (positionsDeg) =>
    set({
      targetPositionsDeg: dummyProfile.joints.map((joint) => {
        const value = positionsDeg[joint.protocolIndex] ?? 0;
        return clampJointTargetDeg(dummyProfile, joint.protocolIndex, value) ?? 0;
      }),
      measuredAlignmentPending: false
    }),
  loadActionPreview: (positionsDeg) => {
    if (positionsDeg.length !== dummyProfile.model.dof || positionsDeg.some((value) => !Number.isFinite(value))) {
      return false;
    }
    set({ targetPositionsDeg: [...positionsDeg], measuredAlignmentPending: false });
    return true;
  },
  loadShowcasePose: () => set({ targetPositionsDeg: defaultTargets(), measuredAlignmentPending: false }),
  beginHardwareSession: (hardwareSessionId) => set((state) => state.hardwareSessionId === hardwareSessionId
    ? state
    : { hardwareSessionId, measuredAlignmentPending: true }),
  alignTargetFromMeasured: (sessionId, positionsDeg) => set((state) => {
    if (!state.measuredAlignmentPending || state.hardwareSessionId !== sessionId) return state;
    return {
      targetPositionsDeg: dummyProfile.joints.map((joint) => {
        const value = positionsDeg[joint.protocolIndex] ?? 0;
        return clampJointTargetDeg(dummyProfile, joint.protocolIndex, value) ?? 0;
      }),
      measuredAlignmentPending: false
    };
  }),
  endHardwareSession: () => set({ hardwareSessionId: null, measuredAlignmentPending: false }),
  resetSession: (profileId = dummyProfile.profileId) =>
    set({ profileId, targetPositionsDeg: defaultTargets(), hardwareSessionId: null, measuredAlignmentPending: false })
}));
