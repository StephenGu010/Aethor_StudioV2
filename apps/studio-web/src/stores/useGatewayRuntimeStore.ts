import type {
  CommandAuditRecord,
  CommandResult,
  JointStateFrame,
  ProtocolFrame,
  RobotGatewayCapabilitiesV1,
  RobotSessionSnapshot,
  SerialPortDescriptor
} from '@aethor/contracts';
import { create } from 'zustand';
import { reconcileCommandSafetyState, reduceCommandSafetyState } from '../domain/commandSafety';
import { showcaseJointFrame, showcaseSession } from '../fixtures/showcase';
import { useRobotSessionStore } from './useRobotSessionStore';
import { useTelemetryHistoryStore } from './useTelemetryHistoryStore';

export type CommandAuditStatus = 'unavailable' | 'loading' | 'ready' | 'error';
export type SerialPortCatalogStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SerialSessionOperationStatus = 'idle' | 'connecting' | 'disconnecting' | 'error';

interface GatewayRuntimeState {
  capabilities: RobotGatewayCapabilitiesV1 | null;
  session: RobotSessionSnapshot;
  jointState: JointStateFrame;
  protocolFrames: ProtocolFrame[];
  operatorProtocolFrames: ProtocolFrame[];
  commandHistory: CommandAuditRecord[];
  commandAuditStatus: CommandAuditStatus;
  commandAuditError: string | null;
  lastCommandResult: CommandResult | null;
  latchedSafetyResult: CommandResult | null;
  confirmedStopTimestampUtc: string | null;
  transportWarning: string | null;
  activePortName: string | null;
  serialPorts: SerialPortDescriptor[];
  serialPortCatalogStatus: SerialPortCatalogStatus;
  serialPortCatalogError: string | null;
  serialPortCatalogUpdatedAtUtc: string | null;
  selectedPortName: string;
  serialSessionOperationStatus: SerialSessionOperationStatus;
  serialSessionOperationError: string | null;
  setCapabilities: (capabilities: RobotGatewayCapabilitiesV1 | null) => void;
  setSession: (session: RobotSessionSnapshot) => void;
  setJointState: (jointState: JointStateFrame) => void;
  replaceProtocolFrames: (frames: ProtocolFrame[]) => void;
  appendProtocolFrame: (frame: ProtocolFrame) => void;
  beginCommandAuditRefresh: () => void;
  failCommandAuditRefresh: (message: string) => void;
  replaceCommandHistory: (history: CommandAuditRecord[]) => void;
  setLastCommandResult: (result: CommandResult | null) => void;
  setTransportWarning: (warning: string | null) => void;
  setActivePortName: (portName: string | null) => void;
  beginSerialPortRefresh: () => void;
  completeSerialPortRefresh: (ports: SerialPortDescriptor[], updatedAtUtc: string) => void;
  failSerialPortRefresh: (message: string) => void;
  setSelectedPortName: (portName: string) => void;
  beginSerialSessionOperation: (status: Exclude<SerialSessionOperationStatus, 'idle' | 'error'>) => void;
  completeSerialSessionOperation: () => void;
  failSerialSessionOperation: (message: string) => void;
  markTelemetryDegraded: (warning: string) => void;
  completeDisconnect: (session: RobotSessionSnapshot, jointState?: JointStateFrame) => void;
  resetRuntime: () => void;
}

const initialRuntime = () => ({
  capabilities: null,
  session: showcaseSession,
  jointState: showcaseJointFrame,
  protocolFrames: [] as ProtocolFrame[],
  operatorProtocolFrames: [] as ProtocolFrame[],
  commandHistory: [] as CommandAuditRecord[],
  commandAuditStatus: 'unavailable' as CommandAuditStatus,
  commandAuditError: null,
  lastCommandResult: null,
  latchedSafetyResult: null,
  confirmedStopTimestampUtc: null,
  transportWarning: null,
  activePortName: null,
  serialPorts: [] as SerialPortDescriptor[],
  serialPortCatalogStatus: 'idle' as SerialPortCatalogStatus,
  serialPortCatalogError: null,
  serialPortCatalogUpdatedAtUtc: null,
  selectedPortName: '',
  serialSessionOperationStatus: 'idle' as SerialSessionOperationStatus,
  serialSessionOperationError: null
});

export const useGatewayRuntimeStore = create<GatewayRuntimeState>((set) => ({
  ...initialRuntime(),
  setCapabilities: (capabilities) => set({ capabilities }),
  setSession: (session) => {
    useTelemetryHistoryStore.getState().syncSession(session);
    set((state) => {
      const activePortName = session.connectionState === 'offline' || session.connectionState === 'faulted'
        ? null
        : state.activePortName;
      return state.session.sessionId === session.sessionId
      ? { session, activePortName }
      : {
          session,
          lastCommandResult: null,
          latchedSafetyResult: null,
          confirmedStopTimestampUtc: null,
          protocolFrames: [],
          operatorProtocolFrames: [],
          commandHistory: [],
          commandAuditStatus: 'unavailable',
          commandAuditError: null,
          activePortName
        };
    });
  },
  setJointState: (jointState) => {
    useTelemetryHistoryStore.getState().ingestJointState(
      jointState,
      useRobotSessionStore.getState().targetPositionsDeg
    );
    set({ jointState });
  },
  replaceProtocolFrames: (frames) => set(() => {
    const protocolFrames = uniqueProtocolFrames(frames);
    return {
      protocolFrames,
      operatorProtocolFrames: protocolFrames.filter((frame) => !isRoutineJointPositionFrame(frame))
    };
  }),
  appendProtocolFrame: (frame) => set((state) => {
    if (state.protocolFrames.some((candidate) => candidate.id === frame.id)) return {};
    const protocolFrames = [...state.protocolFrames.slice(-255), frame];
    const retainedFrameIds = new Set(protocolFrames.map((candidate) => candidate.id));
    const retainedOperatorFrames = state.operatorProtocolFrames.every((candidate) => retainedFrameIds.has(candidate.id))
      ? state.operatorProtocolFrames
      : state.operatorProtocolFrames.filter((candidate) => retainedFrameIds.has(candidate.id));
    return {
      protocolFrames,
      operatorProtocolFrames: isRoutineJointPositionFrame(frame)
        ? retainedOperatorFrames
        : [...retainedOperatorFrames, frame]
    };
  }),
  beginCommandAuditRefresh: () => set({ commandAuditStatus: 'loading', commandAuditError: null }),
  failCommandAuditRefresh: (commandAuditError) => set({ commandAuditStatus: 'error', commandAuditError }),
  replaceCommandHistory: (commandHistory) => set((state) => {
    const boundedHistory = commandHistory.slice(-128);
    const safetyState = reconcileCommandSafetyState(boundedHistory, state.session.sessionId, {
      latchedResult: state.latchedSafetyResult,
      confirmedStopTimestampUtc: state.confirmedStopTimestampUtc
    });
    return {
      commandHistory: boundedHistory,
      commandAuditStatus: 'ready',
      commandAuditError: null,
      latchedSafetyResult: safetyState.latchedResult,
      confirmedStopTimestampUtc: safetyState.confirmedStopTimestampUtc
    };
  }),
  setLastCommandResult: (lastCommandResult) => set((state) => (
    lastCommandResult === null
      ? { lastCommandResult }
      : lastCommandResult.sessionId === state.session.sessionId
        ? commandResultUpdate(state, lastCommandResult)
        : {}
  )),
  setTransportWarning: (transportWarning) => set({ transportWarning }),
  setActivePortName: (activePortName) => set({ activePortName }),
  beginSerialPortRefresh: () => set({
    serialPortCatalogStatus: 'loading',
    serialPortCatalogError: null
  }),
  completeSerialPortRefresh: (serialPorts, serialPortCatalogUpdatedAtUtc) => set((state) => ({
    serialPorts,
    serialPortCatalogStatus: 'ready',
    serialPortCatalogError: null,
    serialPortCatalogUpdatedAtUtc,
    selectedPortName: state.selectedPortName
      && serialPorts.some((port) => port.portName === state.selectedPortName)
        ? state.selectedPortName
        : ''
  })),
  failSerialPortRefresh: (serialPortCatalogError) => set({
    serialPortCatalogStatus: 'error',
    serialPortCatalogError
  }),
  setSelectedPortName: (selectedPortName) => set({ selectedPortName }),
  beginSerialSessionOperation: (serialSessionOperationStatus) => set({
    serialSessionOperationStatus,
    serialSessionOperationError: null
  }),
  completeSerialSessionOperation: () => set({
    serialSessionOperationStatus: 'idle',
    serialSessionOperationError: null
  }),
  failSerialSessionOperation: (serialSessionOperationError) => set({
    serialSessionOperationStatus: 'error',
    serialSessionOperationError
  }),
  markTelemetryDegraded: (transportWarning) => set((state) => ({
    transportWarning,
    session: state.session.source === 'measured' && state.session.validity === 'valid'
      ? { ...state.session, validity: 'stale' }
      : state.session,
    jointState: state.jointState.source === 'measured' && state.jointState.validity === 'valid'
      ? { ...state.jointState, validity: 'stale' }
      : state.jointState
  })),
  completeDisconnect: (session, jointState = showcaseJointFrame) => {
    useTelemetryHistoryStore.getState().resetTelemetryHistory();
    useRobotSessionStore.getState().resetSession();
    set((state) => ({
      ...initialRuntime(),
      capabilities: state.capabilities,
      session,
      jointState
    }));
  },
  resetRuntime: () => {
    useTelemetryHistoryStore.getState().resetTelemetryHistory();
    set(initialRuntime());
  }
}));

function uniqueProtocolFrames(frames: ProtocolFrame[]) {
  const seen = new Set<string>();
  const uniqueNewestFirst: ProtocolFrame[] = [];
  for (let index = frames.length - 1; index >= 0 && uniqueNewestFirst.length < 256; index -= 1) {
    const frame = frames[index];
    if (!frame || seen.has(frame.id)) continue;
    seen.add(frame.id);
    uniqueNewestFirst.push(frame);
  }
  return uniqueNewestFirst.reverse();
}

export function isRoutineJointPositionFrame(frame: ProtocolFrame) {
  return frame.direction === 'tx' && frame.raw.trim() === '#GETJPOS'
    || frame.direction === 'rx' && frame.parsedKind === 'jointPositions';
}

function commandResultUpdate(state: GatewayRuntimeState, result: CommandResult) {
  const safetyState = reduceCommandSafetyState({
    latchedResult: state.latchedSafetyResult,
    confirmedStopTimestampUtc: state.confirmedStopTimestampUtc
  }, result);
  return {
    lastCommandResult: shouldReplaceLastResult(state.lastCommandResult, result)
      ? result
      : state.lastCommandResult,
    latchedSafetyResult: safetyState.latchedResult,
    confirmedStopTimestampUtc: safetyState.confirmedStopTimestampUtc
  };
}

function shouldReplaceLastResult(current: CommandResult | null, incoming: CommandResult) {
  if (current === null || current.commandId === incoming.commandId) return true;
  const currentTimestamp = Date.parse(current.timestampUtc);
  const incomingTimestamp = Date.parse(incoming.timestampUtc);
  return Number.isFinite(incomingTimestamp)
    && (!Number.isFinite(currentTimestamp) || incomingTimestamp >= currentTimestamp);
}
