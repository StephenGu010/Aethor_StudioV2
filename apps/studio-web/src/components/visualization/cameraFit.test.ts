import { describe, expect, it } from 'vitest';
import { calculatePerspectiveCameraFit, type SceneBounds, type Vector3Tuple } from './cameraFit';

describe('perspective camera fit', () => {
  it('centres translated bounds and keeps every corner inside the padded frustum', () => {
    const bounds: SceneBounds = { min: [2, -1, 4], max: [4, 3, 8] };
    const fit = calculatePerspectiveCameraFit(bounds, 39, 16 / 9);

    expect(fit).not.toBeNull();
    expect(fit!.target).toEqual([3, 1, 6]);
    expect(fit!.distance).toBeGreaterThan(0);
    expect(fit!.near).toBeGreaterThan(0);
    expect(fit!.far).toBeGreaterThan(fit!.distance);
    expect(fit!.minDistance).toBeLessThan(fit!.distance);
    expect(fit!.maxDistance).toBeGreaterThan(fit!.distance);

    for (const corner of corners(bounds)) {
      expect(inViewport(projectedNdc(corner, fit!, 39, 16 / 9))).toBe(true);
    }
  });

  it('backs away for a narrow viewport and scales with the model', () => {
    const bounds: SceneBounds = { min: [-1, 0, -1], max: [1, 2, 1] };
    const wide = calculatePerspectiveCameraFit(bounds, 39, 16 / 9)!;
    const narrow = calculatePerspectiveCameraFit(bounds, 39, 3 / 4)!;
    const doubled = calculatePerspectiveCameraFit({ min: [-2, 0, -2], max: [2, 4, 2] }, 39, 16 / 9)!;

    expect(narrow.distance).toBeGreaterThan(wide.distance);
    expect(doubled.distance).toBeCloseTo(wide.distance * 2, 10);
  });

  it('rejects invalid or inverted bounds instead of producing an unsafe camera', () => {
    expect(calculatePerspectiveCameraFit({ min: [1, 0, 0], max: [0, 1, 1] }, 39, 1)).toBeNull();
    expect(calculatePerspectiveCameraFit({ min: [0, 0, 0], max: [1, 1, 1] }, Number.NaN, 1)).toBeNull();
    expect(calculatePerspectiveCameraFit({ min: [0, 0, 0], max: [1, 1, 1] }, 39, 0)).toBeNull();
  });
});

function corners(bounds: SceneBounds): Vector3Tuple[] {
  return [bounds.min[0], bounds.max[0]].flatMap((x) =>
    [bounds.min[1], bounds.max[1]].flatMap((y) =>
      [bounds.min[2], bounds.max[2]].map((z) => [x, y, z] as const)));
}

function projectedNdc(
  point: Vector3Tuple,
  fit: NonNullable<ReturnType<typeof calculatePerspectiveCameraFit>>,
  verticalFovDeg: number,
  aspect: number
) {
  const backward = normalize(subtract(fit.position, fit.target));
  const right = normalize(cross([0, 1, 0], backward));
  const cameraUp = normalize(cross(backward, right));
  const offset = subtract(point, fit.position);
  const depth = -dot(offset, backward);
  const verticalTangent = Math.tan((verticalFovDeg * Math.PI / 180) * 0.5);
  return {
    x: dot(offset, right) / (depth * verticalTangent * aspect),
    y: dot(offset, cameraUp) / (depth * verticalTangent),
    depth
  };
}

function inViewport(value: { x: number; y: number; depth: number }) {
  return value.depth > 0 && Math.abs(value.x) <= 1 && Math.abs(value.y) <= 1;
}

function subtract(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vector3Tuple, right: Vector3Tuple) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function normalize(value: Vector3Tuple): Vector3Tuple {
  const length = Math.sqrt(dot(value, value));
  return [value[0] / length, value[1] / length, value[2] / length];
}
