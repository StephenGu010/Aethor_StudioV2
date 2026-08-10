import { describe, expect, it } from 'vitest';
import { calculateReferenceGridLayout } from './referenceGrid';

describe('calculateReferenceGridLayout', () => {
  it('places an expanded grid below the complete model bounds', () => {
    const layout = calculateReferenceGridLayout({
      min: [-1, -0.4, -0.5],
      max: [1, 1.6, 1.5]
    });

    expect(layout).toEqual({
      size: 6,
      divisions: 48,
      position: [0, -0.52, 0.5],
      modelMinY: -0.4,
      footprintSize: 2,
      clearance: 0.12
    });
    expect(layout!.position[1]).toBeLessThan(layout!.modelMinY);
    expect(layout!.size).toBeGreaterThan(layout!.footprintSize);
  });

  it('keeps small models legible and bounds line density for large models', () => {
    expect(calculateReferenceGridLayout({ min: [0, 0, 0], max: [0.2, 0.2, 0.2] }))
      .toMatchObject({ size: 6, divisions: 48, clearance: 0.08 });
    expect(calculateReferenceGridLayout({ min: [-10, -2, -10], max: [10, 2, 10] }))
      .toMatchObject({ size: 40, divisions: 80, clearance: 0.24 });
  });

  it('rejects invalid bounds instead of placing an unsafe reference plane', () => {
    expect(calculateReferenceGridLayout({ min: [1, 0, 0], max: [0, 1, 1] })).toBeNull();
    expect(calculateReferenceGridLayout({ min: [0, 0, 0], max: [Number.NaN, 1, 1] })).toBeNull();
  });
});
