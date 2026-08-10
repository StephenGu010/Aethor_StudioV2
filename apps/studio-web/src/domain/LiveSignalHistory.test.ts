import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import {
  LiveSignalHistory,
  TELEMETRY_MAX_SAMPLES_PER_SIGNAL
} from './LiveSignalHistory';

describe('LiveSignalHistory', () => {
  it('derives measured, commanded, and computed series without mixing profiles', () => {
    const history = new LiveSignalHistory(dummyProfile);
    history.beginSession('session-1', 'dummy-6dof');

    expect(history.ingest(frame(1, 0, [1, 2, 3, 4, 5, 6]), [2, 4, 6, 8, 10, 12])).toEqual({
      status: 'accepted', detectedGap: 0
    });
    expect(history.ingest({ ...frame(2, 50, [1, 2, 3, 4, 5, 6]), profileId: 'other' }, [])).toMatchObject({
      status: 'invalidFrame'
    });

    const snapshot = history.snapshot([
      'j1.actual.position', 'j1.target.position', 'j1.computed.error'
    ], 60);
    expect(snapshot.series.map((item) => item.descriptor.source)).toEqual(['measured', 'commanded', 'computed']);
    expect(snapshot.series.map((item) => item.samples[0]?.value)).toEqual([1, 2, 1]);
    expect(snapshot.retainedSampleCount).toBe(18);
  });

  it('detects gaps, rejects duplicate/out-of-order frames, and clears on session identity change', () => {
    const history = new LiveSignalHistory(dummyProfile);
    history.beginSession('session-1', 'dummy-6dof');
    expect(history.ingest(frame(10, 0), zeros()).status).toBe('accepted');
    expect(history.ingest(frame(13, 50), zeros())).toEqual({ status: 'accepted', detectedGap: 2 });
    expect(history.ingest(frame(13, 50), zeros()).status).toBe('duplicate');
    expect(history.ingest(frame(12, 100), zeros()).status).toBe('outOfOrder');
    expect(history.snapshot(['j1.actual.position'], 60)).toMatchObject({
      acceptedFrameCount: 2,
      rejectedFrameCount: 2,
      detectedDroppedFrameCount: 2,
      retainedSamplesPerSignal: 2
    });

    expect(history.beginSession('session-2', 'dummy-6dof')).toBe(true);
    expect(history.snapshot(['j1.actual.position'], 60)).toMatchObject({
      sessionId: 'session-2', acceptedFrameCount: 0, retainedSampleCount: 0
    });
  });

  it('stays bounded after a synthetic ten-minute 20 Hz capture', () => {
    const history = new LiveSignalHistory(dummyProfile);
    history.beginSession('session-long', 'dummy-6dof');
    for (let index = 0; index < 10 * 60 * 20; index += 1) {
      expect(history.ingest(frame(index, index * 50), zeros()).status).toBe('accepted');
    }

    const snapshot = history.snapshot(history.catalog().map((item) => item.signalId), 120);
    expect(snapshot.retainedSamplesPerSignal).toBe(TELEMETRY_MAX_SAMPLES_PER_SIGNAL);
    expect(snapshot.retainedSampleCount).toBe(18 * TELEMETRY_MAX_SAMPLES_PER_SIGNAL);
    expect(snapshot.captureDurationSeconds).toBeLessThanOrEqual(120);
    expect(snapshot.estimatedSampleRateHz).toBeCloseTo(20, 3);
  });
});

function frame(sequence: number, offsetMs: number, positionsDeg = zeros()) {
  return {
    sequence,
    profileId: 'dummy-6dof',
    timestampUtc: new Date(Date.parse('2026-08-09T00:00:00.000Z') + offsetMs).toISOString(),
    positionsDeg,
    source: 'measured' as const,
    validity: 'valid' as const
  };
}

function zeros() {
  return [0, 0, 0, 0, 0, 0];
}
