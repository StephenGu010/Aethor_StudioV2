import { describe, expect, it } from 'vitest';
import { calculateSceneDevicePixelRatio } from './sceneRenderPolicy';

describe('scene render policy', () => {
  it('preserves the balanced quality ceiling for an ordinary canvas', () => {
    expect(calculateSceneDevicePixelRatio({
      width: 1000,
      height: 700,
      devicePixelRatio: 2,
      quality: 'balanced'
    })).toBe(1.75);
  });

  it('reduces raster density when a large high-DPI canvas exceeds its pixel budget', () => {
    const dpr = calculateSceneDevicePixelRatio({
      width: 2200,
      height: 1300,
      devicePixelRatio: 2,
      quality: 'balanced'
    });

    expect(dpr).toBeCloseTo(1.106, 3);
    expect(2200 * 1300 * dpr * dpr).toBeLessThanOrEqual(3_505_000);
  });

  it('uses the lower constrained ceiling and never returns below one', () => {
    expect(calculateSceneDevicePixelRatio({
      width: 900,
      height: 600,
      devicePixelRatio: 2,
      quality: 'constrained'
    })).toBe(1.2);
    expect(calculateSceneDevicePixelRatio({
      width: 3840,
      height: 2160,
      devicePixelRatio: 2,
      quality: 'constrained'
    })).toBe(1);
  });

  it('fails safely for invalid browser dimensions and DPR values', () => {
    expect(calculateSceneDevicePixelRatio({
      width: Number.NaN,
      height: 0,
      devicePixelRatio: Number.POSITIVE_INFINITY,
      quality: 'balanced'
    })).toBe(1);
  });
});
