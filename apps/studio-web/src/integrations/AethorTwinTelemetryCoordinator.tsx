import { useEffect } from 'react';
import { useAethorRoboConsoleStore } from '../stores/useAethorRoboConsoleStore';

export const AETHOR_TWIN_STALE_AFTER_MS = 250;
const FRESHNESS_CHECK_INTERVAL_MS = 125;

/** Keeps the last pose visible while revoking freshness after telemetry stalls. */
export function AethorTwinTelemetryCoordinator() {
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      useAethorRoboConsoleStore.getState().expireMotorTelemetry(
        Date.now(),
        AETHOR_TWIN_STALE_AFTER_MS
      );
    }, FRESHNESS_CHECK_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, []);
  return null;
}
