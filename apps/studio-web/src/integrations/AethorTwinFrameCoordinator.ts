import type { AethorArmJointGroupId, AethorArmMotorFrameV1 } from '@aethor/contracts';
import {
  createAethorTwinTelemetryMetrics,
  type AethorTwinTelemetryMetrics
} from '../domain/aethorTwinTelemetry';

const RATE_WINDOW_MS = 1_000;
const MAX_RATE_SAMPLES = 256;
const MAX_RETIRED_BOOT_IDS = 4;

export interface AethorTwinFrameScheduler {
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export type AethorTwinFrameSink = (
  frames: readonly AethorArmMotorFrameV1[],
  metrics: Readonly<AethorTwinTelemetryMetrics>,
  committedAtMs: number
) => void;

export type AethorTwinMetricsSink = (
  metrics: Readonly<AethorTwinTelemetryMetrics>
) => void;

interface GroupIngressState {
  sourceId: string;
  bootId: string;
  frameSeq: number;
  receivedAtMs: number;
  retiredBootIds: string[];
}

/**
 * Latest-frame-wins boundary between a high-rate adapter and React state.
 * It never parses serial text and never invents feedback. Each arm keeps at
 * most one pending frame, while both arms are committed in one render batch.
 */
export class AethorTwinFrameCoordinator {
  private readonly pendingFrames = new Map<AethorArmJointGroupId, AethorArmMotorFrameV1>();
  private readonly ingressState = new Map<AethorArmJointGroupId, GroupIngressState>();
  private readonly ingressTimes: number[] = [];
  private readonly commitTimes: number[] = [];
  private scheduledHandle: unknown = null;
  private metrics: AethorTwinTelemetryMetrics = createAethorTwinTelemetryMetrics();

  constructor(
    private readonly sink: AethorTwinFrameSink,
    private readonly scheduler: AethorTwinFrameScheduler = browserFrameScheduler,
    private readonly now: () => number = () => Date.now(),
    private readonly metricsSink?: AethorTwinMetricsSink
  ) {}

  ingest(frame: AethorArmMotorFrameV1) {
    const ingressAtMs = this.now();
    this.metrics.receivedFrameCount += 1;
    this.metrics.lastIngressAtMs = ingressAtMs;
    recordRateSample(this.ingressTimes, ingressAtMs);
    this.metrics.ingressRateHz = this.ingressTimes.length;

    if (!isSupportedFrame(frame) || !this.acceptSequence(frame)) {
      this.metrics.rejectedFrameCount += 1;
      this.metricsSink?.({ ...this.metrics });
      return false;
    }

    if (this.pendingFrames.has(frame.jointGroupId)) {
      this.metrics.coalescedFrameCount += 1;
    }
    this.pendingFrames.set(frame.jointGroupId, frame);
    if (this.scheduledHandle === null) {
      this.scheduledHandle = this.scheduler.request(() => {
        this.scheduledHandle = null;
        this.commitPending();
      });
    }
    return true;
  }

  flushNow() {
    if (this.scheduledHandle !== null) {
      this.scheduler.cancel(this.scheduledHandle);
      this.scheduledHandle = null;
    }
    this.commitPending();
  }

  reset() {
    if (this.scheduledHandle !== null) this.scheduler.cancel(this.scheduledHandle);
    this.scheduledHandle = null;
    this.pendingFrames.clear();
    this.ingressState.clear();
    this.ingressTimes.length = 0;
    this.commitTimes.length = 0;
    this.metrics = createAethorTwinTelemetryMetrics();
  }

  getMetrics(): Readonly<AethorTwinTelemetryMetrics> {
    return { ...this.metrics };
  }

  private acceptSequence(frame: AethorArmMotorFrameV1) {
    const sourceId = `${frame.controllerId}\u0000${frame.armId}`;
    const prior = this.ingressState.get(frame.jointGroupId);
    if (!prior) {
      this.ingressState.set(frame.jointGroupId, {
        sourceId,
        bootId: frame.bootId,
        frameSeq: frame.frameSeq,
        receivedAtMs: Date.parse(frame.receivedAtUtc),
        retiredBootIds: []
      });
      return true;
    }
    if (prior.sourceId !== sourceId) return false;

    if (frame.bootId === prior.bootId) {
      if (frame.frameSeq <= prior.frameSeq) return false;
      prior.frameSeq = frame.frameSeq;
      prior.receivedAtMs = Math.max(prior.receivedAtMs, Date.parse(frame.receivedAtUtc));
      return true;
    }

    if (prior.retiredBootIds.includes(frame.bootId)) return false;
    const receivedAtMs = Date.parse(frame.receivedAtUtc);
    if (receivedAtMs < prior.receivedAtMs) return false;
    prior.retiredBootIds.push(prior.bootId);
    if (prior.retiredBootIds.length > MAX_RETIRED_BOOT_IDS) prior.retiredBootIds.shift();
    prior.bootId = frame.bootId;
    prior.frameSeq = frame.frameSeq;
    prior.receivedAtMs = receivedAtMs;
    return true;
  }

  private commitPending() {
    if (this.pendingFrames.size === 0) return;
    const committedAtMs = this.now();
    const frames = (['left-arm', 'right-arm'] as const)
      .map((groupId) => this.pendingFrames.get(groupId))
      .filter((frame): frame is AethorArmMotorFrameV1 => frame !== undefined);
    this.pendingFrames.clear();
    this.metrics.appliedFrameCount += frames.length;
    this.metrics.renderCommitCount += 1;
    this.metrics.lastCommitAtMs = committedAtMs;
    recordRateSample(this.commitTimes, committedAtMs);
    this.metrics.modelUpdateRateHz = this.commitTimes.length;
    this.sink(frames, { ...this.metrics }, committedAtMs);
  }
}

function isSupportedFrame(frame: AethorArmMotorFrameV1) {
  return frame.contractVersion === '1.0'
    && frame.profileId === 'aethor-robo-dual-7dof'
    && (frame.jointGroupId === 'left-arm' || frame.jointGroupId === 'right-arm')
    && Number.isInteger(frame.frameSeq)
    && frame.frameSeq >= 0
    && frame.frameSeq <= 0xFFFF_FFFF
    && Number.isFinite(Date.parse(frame.receivedAtUtc));
}

function recordRateSample(samples: number[], nowMs: number) {
  samples.push(nowMs);
  const cutoff = nowMs - RATE_WINDOW_MS;
  while (samples.length > 0 && samples[0]! <= cutoff) samples.shift();
  if (samples.length > MAX_RATE_SAMPLES) {
    samples.splice(0, samples.length - MAX_RATE_SAMPLES);
  }
}

const browserFrameScheduler: AethorTwinFrameScheduler = {
  request(callback) {
    // A 20 ms budget caps React/Three projection at 50 Hz while the adapter may
    // continue receiving 50-100 Hz device telemetry without backlogging.
    return globalThis.setTimeout(callback, 20);
  },
  cancel(handle) {
    if (typeof handle !== 'number') return;
    globalThis.clearTimeout(handle);
  }
};
