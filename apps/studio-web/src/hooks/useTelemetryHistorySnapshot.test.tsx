import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTelemetryHistoryStore } from '../stores/useTelemetryHistoryStore';
import { useTelemetryHistorySnapshot } from './useTelemetryHistorySnapshot';

describe('useTelemetryHistorySnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));
    useTelemetryHistoryStore.getState().resetTelemetryHistory();
    useTelemetryHistoryStore.getState().syncSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'unknown',
      controlMode: null, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
  });

  afterEach(() => vi.useRealTimers());

  it('captures every frame while limiting visible chart refreshes to ten hertz', () => {
    const { result } = renderHook(() => useTelemetryHistorySnapshot(['j1.actual.position'], 60));
    act(() => {
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        useTelemetryHistoryStore.getState().ingestJointState({
          sequence,
          profileId: 'dummy-6dof',
          timestampUtc: new Date(Date.parse('2026-08-09T00:00:00.000Z') + sequence * 10).toISOString(),
          positionsDeg: [sequence, 2, 3, 4, 5, 6],
          source: 'measured',
          validity: 'valid'
        }, [10, 20, 30, 40, 50, 60]);
      }
    });

    expect(result.current.retainedSamplesPerSignal).toBe(0);
    act(() => vi.advanceTimersByTime(99));
    expect(result.current.retainedSamplesPerSignal).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.retainedSamplesPerSignal).toBe(3);
  });
});
