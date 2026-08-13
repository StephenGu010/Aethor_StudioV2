import { create } from 'zustand';
import {
  applyAethorArmMotorFrame,
  createAethorArmMotorSnapshot,
  expireAethorArmMotorSnapshot,
  type AethorArmMotorFrameV1,
  type AethorArmMotorSnapshot
} from '../domain/aethorArmMotorState';
import {
  createAethorTwinTelemetryMetrics,
  type AethorTwinTelemetryMetrics
} from '../domain/aethorTwinTelemetry';
import { clampJointTargetDeg } from '../domain/jointInteraction';
import { aethorRoboProfile } from '../profile/aethorRoboProfile';

interface AethorRoboConsoleState {
  actualPositionsDeg: number[];
  targetPositionsDeg: number[];
  motorSnapshots: Record<string, AethorArmMotorSnapshot>;
  telemetryMetrics: AethorTwinTelemetryMetrics;
  setJointTarget: (protocolIndex: number, valueDeg: number) => void;
  alignTarget: (positionsDeg: readonly number[]) => void;
  applyMotorFrames: (
    frames: readonly AethorArmMotorFrameV1[],
    metrics: Readonly<AethorTwinTelemetryMetrics>,
    committedAtMs: number
  ) => void;
  expireMotorTelemetry: (nowMs: number, staleAfterMs: number) => void;
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
  telemetryMetrics: createAethorTwinTelemetryMetrics(),
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
  applyMotorFrames: (frames, metrics, committedAtMs) => set((state) => {
    if (frames.length === 0) return { telemetryMetrics: { ...metrics } };
    let actualPositionsDeg = state.actualPositionsDeg;
    let motorSnapshots = state.motorSnapshots;
    frames.forEach((frame) => {
      const groupId = frame.jointGroupId;
      const previous = motorSnapshots[groupId]
        ?? createAethorArmMotorSnapshot(aethorRoboProfile, groupId, actualPositionsDeg);
      const next = applyAethorArmMotorFrame(
        aethorRoboProfile,
        { ...previous, actualPositionsDeg },
        frame,
        committedAtMs
      );
      actualPositionsDeg = [...next.actualPositionsDeg];
      motorSnapshots = { ...motorSnapshots, [groupId]: next };
    });
    return {
      actualPositionsDeg,
      motorSnapshots,
      telemetryMetrics: { ...metrics }
    };
  }),
  expireMotorTelemetry: (nowMs, staleAfterMs) => set((state) => {
    let changed = false;
    const motorSnapshots = Object.fromEntries(Object.entries(state.motorSnapshots).map(([groupId, snapshot]) => {
      const next = expireAethorArmMotorSnapshot(snapshot, nowMs, staleAfterMs);
      if (next !== snapshot) changed = true;
      return [groupId, next];
    }));
    const ratesNeedReset = state.telemetryMetrics.lastIngressAtMs !== null
      && nowMs - state.telemetryMetrics.lastIngressAtMs >= staleAfterMs
      && (state.telemetryMetrics.ingressRateHz !== 0 || state.telemetryMetrics.modelUpdateRateHz !== 0);
    return changed || ratesNeedReset ? {
      motorSnapshots,
      telemetryMetrics: {
        ...state.telemetryMetrics,
        ingressRateHz: 0,
        modelUpdateRateHz: 0
      }
    } : state;
  }),
  clearMotorTelemetry: () => set({
    actualPositionsDeg: defaultPositions(),
    motorSnapshots: {},
    telemetryMetrics: createAethorTwinTelemetryMetrics()
  }),
  resetPreview: () => set({
    actualPositionsDeg: defaultPositions(),
    targetPositionsDeg: defaultPositions(),
    motorSnapshots: {},
    telemetryMetrics: createAethorTwinTelemetryMetrics()
  })
}));
