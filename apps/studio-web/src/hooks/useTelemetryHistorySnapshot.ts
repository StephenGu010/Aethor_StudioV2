import { useEffect, useMemo, useState } from 'react';
import type { LiveSignalHistorySnapshot } from '../domain/LiveSignalHistory';
import {
  getLiveSignalHistorySnapshot,
  useTelemetryHistoryStore
} from '../stores/useTelemetryHistoryStore';

export const TELEMETRY_CHART_VISIBLE_REFRESH_MS = 100;
export const TELEMETRY_CHART_HIDDEN_REFRESH_MS = 1_000;

export function useTelemetryHistorySnapshot(signalIds: readonly string[], windowSeconds: number) {
  const signalKey = signalIds.join(',');
  const stableSignalIds = useMemo(() => signalKey.split(',').filter(Boolean), [signalKey]);
  const [snapshot, setSnapshot] = useState<LiveSignalHistorySnapshot>(() =>
    getLiveSignalHistorySnapshot(stableSignalIds, windowSeconds)
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshMs = 0;

    const refresh = () => {
      timer = null;
      lastRefreshMs = Date.now();
      setSnapshot(getLiveSignalHistorySnapshot(stableSignalIds, windowSeconds));
    };
    const schedule = () => {
      if (timer !== null) return;
      const interval = document.visibilityState === 'hidden'
        ? TELEMETRY_CHART_HIDDEN_REFRESH_MS
        : TELEMETRY_CHART_VISIBLE_REFRESH_MS;
      const remaining = Math.max(0, interval - (Date.now() - lastRefreshMs));
      timer = setTimeout(refresh, remaining);
    };
    const unsubscribe = useTelemetryHistoryStore.subscribe((state, previous) => {
      if (state.revision !== previous.revision) schedule();
    });
    const handleVisibilityChange = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === 'visible') refresh();
      else schedule();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    refresh();
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [stableSignalIds, windowSeconds]);

  return snapshot;
}
