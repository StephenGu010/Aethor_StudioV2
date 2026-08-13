export interface AethorTwinTelemetryMetrics {
  receivedFrameCount: number;
  appliedFrameCount: number;
  coalescedFrameCount: number;
  rejectedFrameCount: number;
  renderCommitCount: number;
  ingressRateHz: number;
  modelUpdateRateHz: number;
  lastIngressAtMs: number | null;
  lastCommitAtMs: number | null;
}

export function createAethorTwinTelemetryMetrics(): AethorTwinTelemetryMetrics {
  return {
    receivedFrameCount: 0,
    appliedFrameCount: 0,
    coalescedFrameCount: 0,
    rejectedFrameCount: 0,
    renderCommitCount: 0,
    ingressRateHz: 0,
    modelUpdateRateHz: 0,
    lastIngressAtMs: null,
    lastCommitAtMs: null
  };
}
