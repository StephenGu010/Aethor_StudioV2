import type { AethorArmMotorFrameV1 } from '@aethor/contracts';
import { useAethorRoboConsoleStore } from '../stores/useAethorRoboConsoleStore';
import { AethorTwinFrameCoordinator } from './AethorTwinFrameCoordinator';

const coordinator = new AethorTwinFrameCoordinator(
  (frames, metrics, committedAtMs) => {
    useAethorRoboConsoleStore.getState().applyMotorFrames(frames, metrics, committedAtMs);
  },
  undefined,
  undefined,
  (metrics) => {
    useAethorRoboConsoleStore.getState().applyMotorFrames([], metrics, Date.now());
  }
);

/** Production adapter seam. Serial codecs and SignalR handlers submit frames here. */
export function ingestAethorTwinMotorFrame(frame: AethorArmMotorFrameV1) {
  return coordinator.ingest(frame);
}

export function resetAethorTwinTelemetryRuntime() {
  coordinator.reset();
}

export function flushAethorTwinTelemetryForTest() {
  coordinator.flushNow();
}
