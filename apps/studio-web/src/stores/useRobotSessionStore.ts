import { create } from 'zustand';
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
      const joint = dummyProfile.joints.find((candidate) => candidate.protocolIndex === protocolIndex);
      if (!joint || !Number.isFinite(valueDeg)) return state;
      const targetPositionsDeg = [...state.targetPositionsDeg];
      targetPositionsDeg[protocolIndex] = Math.min(joint.upperDeg, Math.max(joint.lowerDeg, valueDeg));
      return { targetPositionsDeg };
    }),
  alignTarget: (positionsDeg) =>
    set({
      targetPositionsDeg: dummyProfile.joints.map((joint) => {
        const value = positionsDeg[joint.protocolIndex] ?? 0;
        return Math.min(joint.upperDeg, Math.max(joint.lowerDeg, value));
      })
    }),
  loadShowcasePose: () => set({ targetPositionsDeg: defaultTargets() }),
  setTerminalExpertUnlocked: (terminalExpertUnlocked) => set({ terminalExpertUnlocked }),
  resetSession: (profileId = dummyProfile.profileId) =>
    set({ profileId, targetPositionsDeg: defaultTargets(), terminalExpertUnlocked: false })
}));

