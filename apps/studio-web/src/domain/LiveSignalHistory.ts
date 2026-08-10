import type {
  DataSource,
  JointStateFrame,
  RobotProfileManifestV1,
  SignalDescriptor,
  SignalSeries,
  Validity
} from '@aethor/contracts';
import { BoundedSignalBuffer } from './BoundedSignalBuffer';

export const TELEMETRY_DEFAULT_WINDOW_SECONDS = 60;
export const TELEMETRY_MAX_WINDOW_SECONDS = 120;
export const TELEMETRY_MAX_CAPTURE_RATE_HZ = 20;
export const TELEMETRY_MAX_SAMPLES_PER_SIGNAL = TELEMETRY_MAX_WINDOW_SECONDS * TELEMETRY_MAX_CAPTURE_RATE_HZ;

export type TelemetryIngestStatus = 'accepted' | 'inactiveSession' | 'invalidFrame' | 'duplicate' | 'outOfOrder';

export interface TelemetryIngestResult {
  status: TelemetryIngestStatus;
  detectedGap: number;
}

export interface LiveSignalHistorySnapshot {
  sessionId: string | null;
  profileId: string | null;
  series: SignalSeries[];
  acceptedFrameCount: number;
  rejectedFrameCount: number;
  detectedDroppedFrameCount: number;
  retainedSamplesPerSignal: number;
  retainedSampleCount: number;
  captureDurationSeconds: number;
  estimatedSampleRateHz: number | null;
  latestTimestampUtc: string | null;
}

const jointColors = ['#a9c7d8', '#d7ddd8', '#73a98f', '#d6b35a', '#a7a0c8', '#c99a79'];

export class LiveSignalHistory {
  private readonly descriptors: SignalDescriptor[];
  private readonly buffers = new Map<string, BoundedSignalBuffer>();
  private sessionId: string | null = null;
  private profileId: string | null = null;
  private lastSequence: number | null = null;
  private lastTimestampMs: number | null = null;
  private acceptedFrameCount = 0;
  private rejectedFrameCount = 0;
  private detectedDroppedFrameCount = 0;

  constructor(private readonly profile: RobotProfileManifestV1) {
    this.descriptors = createJointSignalDescriptors(profile, 'measured');
    for (const descriptor of this.descriptors) {
      this.buffers.set(descriptor.signalId, new BoundedSignalBuffer(
        TELEMETRY_MAX_SAMPLES_PER_SIGNAL,
        TELEMETRY_MAX_WINDOW_SECONDS * 1_000
      ));
    }
  }

  beginSession(sessionId: string | null, profileId: string | null) {
    if (this.sessionId === sessionId && this.profileId === profileId) return false;
    this.sessionId = sessionId;
    this.profileId = profileId;
    this.clearSamples();
    return true;
  }

  ingest(frame: JointStateFrame, targetPositionsDeg: readonly number[]): TelemetryIngestResult {
    if (!this.sessionId || this.profileId !== this.profile.profileId) return this.rejected('inactiveSession');
    const timestampMs = Date.parse(frame.timestampUtc);
    if (
      frame.profileId !== this.profileId
      || frame.source !== 'measured'
      || frame.validity !== 'valid'
      || !Number.isInteger(frame.sequence)
      || frame.sequence < 0
      || !Number.isFinite(timestampMs)
      || frame.positionsDeg.length !== this.profile.model.dof
      || frame.positionsDeg.some((value) => !Number.isFinite(value))
    ) return this.rejected('invalidFrame');

    if (this.lastSequence !== null) {
      if (frame.sequence === this.lastSequence) return this.rejected('duplicate');
      if (frame.sequence < this.lastSequence || (this.lastTimestampMs !== null && timestampMs < this.lastTimestampMs)) {
        return this.rejected('outOfOrder');
      }
    }

    const detectedGap = this.lastSequence === null ? 0 : Math.max(0, frame.sequence - this.lastSequence - 1);
    this.detectedDroppedFrameCount += detectedGap;
    for (const joint of this.profile.joints) {
      const actualValue = frame.positionsDeg[joint.protocolIndex] ?? null;
      const targetCandidate = targetPositionsDeg[joint.protocolIndex];
      const targetValue = typeof targetCandidate === 'number' && Number.isFinite(targetCandidate) ? targetCandidate : null;
      const targetValidity: Validity = targetValue === null ? 'invalid' : 'valid';
      this.push(`j${joint.protocolIndex + 1}.actual.position`, frame.timestampUtc, actualValue, frame.validity);
      this.push(`j${joint.protocolIndex + 1}.target.position`, frame.timestampUtc, targetValue, targetValidity);
      this.push(
        `j${joint.protocolIndex + 1}.computed.error`,
        frame.timestampUtc,
        actualValue === null || targetValue === null ? null : targetValue - actualValue,
        targetValue === null ? 'invalid' : frame.validity
      );
    }
    this.lastSequence = frame.sequence;
    this.lastTimestampMs = timestampMs;
    this.acceptedFrameCount += 1;
    return { status: 'accepted', detectedGap };
  }

  catalog(): SignalDescriptor[] {
    return this.descriptors.map((descriptor) => ({ ...descriptor }));
  }

  snapshot(signalIds: readonly string[], windowSeconds: number): LiveSignalHistorySnapshot {
    const boundedWindowSeconds = Math.min(TELEMETRY_MAX_WINDOW_SECONDS, Math.max(1, windowSeconds));
    const cutoffUtc = this.lastTimestampMs === null
      ? null
      : new Date(this.lastTimestampMs - boundedWindowSeconds * 1_000).toISOString();
    const requestedIds = new Set(signalIds);
    const series = this.descriptors
      .filter((descriptor) => requestedIds.has(descriptor.signalId))
      .map((descriptor) => ({
        descriptor: { ...descriptor },
        samples: [...(cutoffUtc
          ? this.requireBuffer(descriptor.signalId).snapshotSince(cutoffUtc)
          : this.requireBuffer(descriptor.signalId).snapshot())]
      }));
    const reference = series[0]?.samples ?? [];
    const firstTimestampMs = reference[0] ? Date.parse(reference[0].timestampUtc) : null;
    const lastTimestampMs = reference.at(-1) ? Date.parse(reference.at(-1)!.timestampUtc) : null;
    const captureDurationSeconds = firstTimestampMs !== null && lastTimestampMs !== null
      ? Math.max(0, (lastTimestampMs - firstTimestampMs) / 1_000)
      : 0;
    const estimatedSampleRateHz = reference.length > 1 && captureDurationSeconds > 0
      ? (reference.length - 1) / captureDurationSeconds
      : null;
    return {
      sessionId: this.sessionId,
      profileId: this.profileId,
      series,
      acceptedFrameCount: this.acceptedFrameCount,
      rejectedFrameCount: this.rejectedFrameCount,
      detectedDroppedFrameCount: this.detectedDroppedFrameCount,
      retainedSamplesPerSignal: reference.length,
      retainedSampleCount: [...this.buffers.values()].reduce((total, buffer) => total + buffer.size, 0),
      captureDurationSeconds,
      estimatedSampleRateHz,
      latestTimestampUtc: this.lastTimestampMs === null ? null : new Date(this.lastTimestampMs).toISOString()
    };
  }

  reset() {
    this.sessionId = null;
    this.profileId = null;
    this.clearSamples();
  }

  private rejected(status: Exclude<TelemetryIngestStatus, 'accepted'>): TelemetryIngestResult {
    this.rejectedFrameCount += 1;
    return { status, detectedGap: 0 };
  }

  private push(signalId: string, timestampUtc: string, value: number | null, validity: Validity) {
    this.requireBuffer(signalId).push({ timestampUtc, value, validity });
  }

  private requireBuffer(signalId: string) {
    const buffer = this.buffers.get(signalId);
    if (!buffer) throw new Error(`Unknown signal ${signalId}`);
    return buffer;
  }

  private clearSamples() {
    for (const buffer of this.buffers.values()) buffer.clear();
    this.lastSequence = null;
    this.lastTimestampMs = null;
    this.acceptedFrameCount = 0;
    this.rejectedFrameCount = 0;
    this.detectedDroppedFrameCount = 0;
  }
}

export function createJointSignalDescriptors(profile: RobotProfileManifestV1, actualSource: DataSource) {
  return profile.joints.flatMap((joint) => {
    const jointNumber = joint.protocolIndex + 1;
    const color = jointColors[joint.protocolIndex] ?? '#d7ddd8';
    return [
      {
        signalId: `j${jointNumber}.actual.position`, displayName: `J${jointNumber} Actual`, unit: 'deg' as const,
        source: actualSource, color, jointId: joint.jointId
      },
      {
        signalId: `j${jointNumber}.target.position`, displayName: `J${jointNumber} Target`, unit: 'deg' as const,
        source: 'commanded' as const, color, dashed: true, jointId: joint.jointId
      },
      {
        signalId: `j${jointNumber}.computed.error`, displayName: `J${jointNumber} Error`, unit: 'deg' as const,
        source: 'computed' as const, color: '#d6b35a', jointId: joint.jointId
      }
    ];
  });
}
