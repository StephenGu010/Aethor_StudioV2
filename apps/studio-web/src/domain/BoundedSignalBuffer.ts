import type { SignalSample } from '../contracts/types';

export class BoundedSignalBuffer {
  readonly maxSamples: number;
  private samples: SignalSample[] = [];

  constructor(maxSamples: number) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error('maxSamples must be a positive integer');
    this.maxSamples = maxSamples;
  }

  push(sample: SignalSample) {
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
  }

  snapshot(): readonly SignalSample[] {
    return this.samples.map((sample) => ({ ...sample }));
  }

  clear() {
    this.samples = [];
  }
}
