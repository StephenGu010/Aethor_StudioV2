import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryHistoryStore, getLiveSignalHistorySnapshot } from './useTelemetryHistoryStore';

describe('telemetry history store', () => {
  beforeEach(() => useTelemetryHistoryStore.getState().resetTelemetryHistory());

  it('captures valid measured frames only for an active hardware session', () => {
    const store = useTelemetryHistoryStore.getState();
    store.syncSession(session('session-1', 'connected'));
    store.ingestJointState(frame(1), [10, 20, 30, 40, 50, 60]);

    expect(getLiveSignalHistorySnapshot(['j1.actual.position'], 60)).toMatchObject({
      sessionId: 'session-1',
      acceptedFrameCount: 1,
      rejectedFrameCount: 0,
      retainedSamplesPerSignal: 1
    });
  });

  it('preserves the same session while reconnecting and resets once offline', () => {
    const store = useTelemetryHistoryStore.getState();
    store.syncSession(session('session-1', 'connected'));
    store.ingestJointState(frame(1), [10, 20, 30, 40, 50, 60]);
    store.syncSession(session('session-1', 'reconnecting', 'stale'));
    expect(getLiveSignalHistorySnapshot(['j1.actual.position'], 60).retainedSamplesPerSignal).toBe(1);

    store.syncSession(session('session-1', 'offline', 'unavailable'));
    expect(getLiveSignalHistorySnapshot(['j1.actual.position'], 60)).toMatchObject({
      sessionId: null,
      acceptedFrameCount: 0,
      retainedSamplesPerSignal: 0
    });
  });
});

function session(
  sessionId: string,
  connectionState: 'connected' | 'reconnecting' | 'offline',
  validity: 'valid' | 'stale' | 'unavailable' = 'valid'
) {
  return {
    sessionId,
    profileId: 'dummy-6dof',
    connectionState,
    motorState: 'unknown' as const,
    controlMode: null,
    timestampUtc: '2026-08-09T00:00:00.000Z',
    source: 'measured' as const,
    validity
  };
}

function frame(sequence: number) {
  return {
    sequence,
    profileId: 'dummy-6dof',
    timestampUtc: new Date(Date.parse('2026-08-09T00:00:00.000Z') + sequence * 50).toISOString(),
    positionsDeg: [1, 2, 3, 4, 5, 6],
    source: 'measured' as const,
    validity: 'valid' as const
  };
}
