import { create } from 'zustand';
import {
  applyAethorArmMotorFrame,
  createAethorArmMotorSnapshot,
  type AethorArmMotorFrameV1,
  type AethorArmMotorSnapshot
} from '../domain/aethorArmMotorState';
import { clampJointTargetDeg } from '../domain/jointInteraction';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';

interface AethorRoboConsoleState {
  actualPositionsDeg: number[];
  targetPositionsDeg: number[];
  motorSnapshots: Record<string, AethorArmMotorSnapshot>;
  setJointTarget: (protocolIndex: number, valueDeg: number) => void;
  alignTarget: (positionsDeg: readonly number[]) => void;
  applyMotorFrame: (frame: AethorArmMotorFrameV1) => void;
  clearMotorTelemetry: () => void;
  resetPreview: () => void;
}

function defaultPositions() {
  return [...(aethorRoboProfile.model.showcasePoseDeg
    ?? Array(aethorRoboProfile.model.dof).fill(0))];
}

export const useAethorRoboConsoleStore = create<AethorRoboConsoleState>((set) => ({
  actualPositionsDeg: defaultPositions(),
  targetPositionsDeg: defaultPositions(),
  motorSnapshots: {},
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
  applyMotorFrame: (frame) => set((state) => {
    const groupId = frame.jointGroupId;
    const previous = state.motorSnapshots[groupId]
      ?? createAethorArmMotorSnapshot(aethorRoboProfile, groupId, state.actualPositionsDeg);
    const next = applyAethorArmMotorFrame(
      aethorRoboProfile,
      { ...previous, actualPositionsDeg: state.actualPositionsDeg },
      frame
    );
    return {
      actualPositionsDeg: [...next.actualPositionsDeg],
      motorSnapshots: { ...state.motorSnapshots, [groupId]: next }
    };
  }),
  clearMotorTelemetry: () => set({
    actualPositionsDeg: defaultPositions(),
    motorSnapshots: {}
  }),
  resetPreview: () => set({
    actualPositionsDeg: defaultPositions(),
    targetPositionsDeg: defaultPositions(),
    motorSnapshots: {}
  })
}));
