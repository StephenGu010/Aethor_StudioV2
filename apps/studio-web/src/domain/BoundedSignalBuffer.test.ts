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
  });
});

function sample(value: number) {
  return { timestampUtc: new Date(value * 1000).toISOString(), value, validity: 'valid' as const };
}
