import { create } from 'zustand';
import { clampJointTargetDeg } from '../domain/jointInteraction';
import { dummyProfile } from '../profile/dummyProfile';

interface RobotSessionState {
  profileId: string;
  targetPositionsDeg: number[];
  terminalExpertUnlocked: boolean;
  setJointTarget: (protocolIndex: number, valueDeg: number) => void;
  alignTarget: (positionsDeg: number[]) => void;
  loadShowcasePose: () => void;
  setTerminalExpertUnlocked: (unlocked: boolean) => void;
  resetSession: (profileId?: string) => void;
}

const defaultTargets = () => [...(dummyProfile.model.showcasePoseDeg ?? Array(dummyProfile.model.dof).fill(0))];

export const useRobotSessionStore = create<RobotSessionState>((set) => ({
  profileId: dummyProfile.profileId,
  targetPositionsDeg: defaultTargets(),
  terminalExpertUnlocked: false,
  setJointTarget: (protocolIndex, valueDeg) =>
    set((state) => {
      const clampedValue = clampJointTargetDeg(dummyProfile, protocolIndex, valueDeg);
      if (clampedValue === undefined) return state;
      const targetPositionsDeg = [...state.targetPositionsDeg];
      targetPositionsDeg[protocolIndex] = clampedValue;
      return { targetPositionsDeg };
    }),
  alignTarget: (positionsDeg) =>
    set({
      targetPositionsDeg: dummyProfile.joints.map((joint) => {
        const value = positionsDeg[joint.protocolIndex] ?? 0;
        return clampJointTargetDeg(dummyProfile, joint.protocolIndex, value) ?? 0;
      })
    }),
  loadShowcasePose: () => set({ targetPositionsDeg: defaultTargets() }),
  setTerminalExpertUnlocked: (terminalExpertUnlocked) => set({ terminalExpertUnlocked }),
  resetSession: (profileId = dummyProfile.profileId) =>
    set({ profileId, targetPositionsDeg: defaultTargets(), terminalExpertUnlocked: false })
}));
