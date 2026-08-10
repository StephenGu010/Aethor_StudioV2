import type { JointStateFrame, RobotSessionSnapshot } from '@aethor/contracts';
import { create } from 'zustand';
import {
  LiveSignalHistory,
  type LiveSignalHistorySnapshot,
  type TelemetryIngestResult
} from '../domain/LiveSignalHistory';
import { dummyProfile } from '../profile/dummyProfile';

const history = new LiveSignalHistory(dummyProfile);

interface TelemetryHistoryState {
  revision: number;
  lastIngestResult: TelemetryIngestResult | null;
  syncSession: (session: RobotSessionSnapshot) => void;
  ingestJointState: (frame: JointStateFrame, targetPositionsDeg: readonly number[]) => void;
  resetTelemetryHistory: () => void;
}

export const useTelemetryHistoryStore = create<TelemetryHistoryState>((set) => ({
  revision: 0,
  lastIngestResult: null,
  syncSession: (session) => {
    const active = session.profileId === dummyProfile.profileId
      && session.source === 'measured'
      && session.validity !== 'unavailable'
      && session.connectionState !== 'offline';
    const changed = history.beginSession(
      active ? session.sessionId : null,
      active ? session.profileId : null
    );
    if (changed) set((state) => ({ revision: state.revision + 1, lastIngestResult: null }));
  },
  ingestJointState: (frame, targetPositionsDeg) => {
    const lastIngestResult = history.ingest(frame, targetPositionsDeg);
    set((state) => ({ revision: state.revision + 1, lastIngestResult }));
  },
  resetTelemetryHistory: () => {
    history.reset();
    set((state) => ({ revision: state.revision + 1, lastIngestResult: null }));
  }
}));

export function getLiveSignalCatalog() {
  return history.catalog();
}

export function getLiveSignalHistorySnapshot(
  signalIds: readonly string[],
  windowSeconds: number
): LiveSignalHistorySnapshot {
  return history.snapshot(signalIds, windowSeconds);
}
