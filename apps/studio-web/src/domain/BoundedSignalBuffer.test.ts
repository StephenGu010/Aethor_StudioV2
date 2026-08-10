import { describe, expect, it } from 'vitest';
import { BoundedSignalBuffer } from './BoundedSignalBuffer';

describe('BoundedSignalBuffer', () => {
  it('evicts oldest samples and returns detached snapshots', () => {
    const buffer = new BoundedSignalBuffer(2);
    buffer.push(sample(1));
    buffer.push(sample(2));
    buffer.push(sample(3));
    const snapshot = buffer.snapshot();
    expect(snapshot.map((item) => item.value)).toEqual([2, 3]);
    expect(snapshot).not.toBe(buffer.snapshot());
    buffer.clear();
    expect(buffer.snapshot()).toHaveLength(0);
  });

  it('rejects an unbounded or invalid capacity', () => {
    expect(() => new BoundedSignalBuffer(0)).toThrow();
    expect(() => new BoundedSignalBuffer(1.5)).toThrow();
    expect(() => new BoundedSignalBuffer(1, 0)).toThrow();
  });

  it('evicts by time, rejects out-of-order samples, and validates values', () => {
    const buffer = new BoundedSignalBuffer(10, 2_000);
    expect(buffer.push(sample(1))).toBe(true);
    expect(buffer.push(sample(2))).toBe(true);
    expect(buffer.push(sample(4))).toBe(true);
    expect(buffer.snapshot().map((item) => item.value)).toEqual([2, 4]);
    expect(buffer.snapshotSince(new Date(3_000).toISOString()).map((item) => item.value)).toEqual([4]);
    expect(buffer.push(sample(3))).toBe(false);
    expect(buffer.size).toBe(2);
    expect(() => buffer.push({ ...sample(5), value: Number.NaN })).toThrow();
  });
});

function sample(value: number) {
  return { timestampUtc: new Date(value * 1000).toISOString(), value, validity: 'valid' as const };
}
