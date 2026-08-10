import { create } from 'zustand';
import { clampJointTargetDeg } from '../domain/jointInteraction';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';

interface AethorRoboConsoleState {
  targetPositionsDeg: number[];
  setJointTarget: (protocolIndex: number, valueDeg: number) => void;
  alignTarget: (positionsDeg: readonly number[]) => void;
  resetPreview: () => void;
}

function defaultTargets() {
  return [...(aethorRoboProfile.model.showcasePoseDeg
    ?? Array(aethorRoboProfile.model.dof).fill(0))];
}

export const useAethorRoboConsoleStore = create<AethorRoboConsoleState>((set) => ({
  targetPositionsDeg: defaultTargets(),
  setJointTarget: (protocolIndex, valueDeg) => set((state) => {
    const clamped = clampJointTargetDeg(aethorRoboProfile, protocolIndex, valueDeg);
    if (clamped === undefined) return state;
    const targetPositionsDeg = [...state.targetPositionsDeg];
    targetPositionsDeg[protocolIndex] = clamped;
    return { targetPositionsDeg };
  }),
  alignTarget: (positionsDeg) => set({
    targetPositionsDeg: aethorRoboProfile.joints.map((joint) => {
      const value = positionsDeg[joint.protocolIndex] ?? 0;
      return clampJointTargetDeg(aethorRoboProfile, joint.protocolIndex, value) ?? 0;
    })
  }),
  resetPreview: () => set({ targetPositionsDeg: defaultTargets() })
}));
