import type { SignalSample } from '@aethor/contracts';

export class BoundedSignalBuffer {
  readonly maxSamples: number;
  readonly maxAgeMs: number;
  private samples: Array<SignalSample | undefined>;
  private start = 0;
  private count = 0;
  private latestTimestampMs: number | null = null;

  constructor(maxSamples: number, maxAgeMs = Number.POSITIVE_INFINITY) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error('maxSamples must be a positive integer');
    if (!(maxAgeMs > 0)) throw new Error('maxAgeMs must be positive');
    this.maxSamples = maxSamples;
    this.maxAgeMs = maxAgeMs;
    this.samples = new Array<SignalSample | undefined>(maxSamples);
  }

  push(sample: SignalSample) {
    const timestampMs = Date.parse(sample.timestampUtc);
    if (!Number.isFinite(timestampMs)) throw new Error('sample timestampUtc must be a valid ISO timestamp');
    if (sample.value !== null && !Number.isFinite(sample.value)) throw new Error('sample value must be finite or null');
    if (this.latestTimestampMs !== null && timestampMs < this.latestTimestampMs) return false;

    const detached = { ...sample };
    if (this.count < this.maxSamples) {
      this.samples[(this.start + this.count) % this.maxSamples] = detached;
      this.count += 1;
    } else {
      this.samples[this.start] = detached;
      this.start = (this.start + 1) % this.maxSamples;
    }
    this.latestTimestampMs = timestampMs;
    this.evictOlderThan(timestampMs - this.maxAgeMs);
    return true;
  }

  snapshot(): readonly SignalSample[] {
    return this.readSamples().map((sample) => ({ ...sample }));
  }

  snapshotSince(timestampUtc: string): readonly SignalSample[] {
    const cutoffMs = Date.parse(timestampUtc);
    if (!Number.isFinite(cutoffMs)) throw new Error('snapshot cutoff must be a valid ISO timestamp');
    return this.readSamples()
      .filter((sample) => Date.parse(sample.timestampUtc) >= cutoffMs)
      .map((sample) => ({ ...sample }));
  }

  get size() {
    return this.count;
  }

  clear() {
    this.samples = new Array<SignalSample | undefined>(this.maxSamples);
    this.start = 0;
    this.count = 0;
    this.latestTimestampMs = null;
  }

  private evictOlderThan(cutoffMs: number) {
    while (this.count > 0) {
      const oldest = this.samples[this.start];
      if (!oldest || Date.parse(oldest.timestampUtc) >= cutoffMs) break;
      this.samples[this.start] = undefined;
      this.start = (this.start + 1) % this.maxSamples;
      this.count -= 1;
    }
  }

  private readSamples() {
    const result: SignalSample[] = [];
    for (let offset = 0; offset < this.count; offset += 1) {
      const sample = this.samples[(this.start + offset) % this.maxSamples];
      if (sample) result.push(sample);
    }
    return result;
  }
}
