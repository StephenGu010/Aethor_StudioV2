export type Vector3Tuple = readonly [number, number, number];

export interface SceneBounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

export interface PerspectiveCameraFit {
  target: Vector3Tuple;
  position: Vector3Tuple;
  distance: number;
  minDistance: number;
  maxDistance: number;
  near: number;
  far: number;
}

const DEFAULT_VIEW_DIRECTION: Vector3Tuple = [0.78, 0.4, 0.84];
const WORLD_UP: Vector3Tuple = [0, 1, 0];

export function calculatePerspectiveCameraFit(
  bounds: SceneBounds,
  verticalFovDeg: number,
  aspect: number,
  padding = 1.18
): PerspectiveCameraFit | null {
  const values = [...bounds.min, ...bounds.max, verticalFovDeg, aspect, padding];
  if (!values.every(Number.isFinite)
    || verticalFovDeg <= 1 || verticalFovDeg >= 175
    || aspect <= 0 || padding < 1
    || bounds.max.some((value, index) => value < bounds.min[index]!)) {
    return null;
  }

  const center = tupleScale(tupleAdd(bounds.min, bounds.max), 0.5);
  const size = tupleSubtract(bounds.max, bounds.min);
  const radius = Math.max(tupleLength(size) * 0.5, 0.001);
  const backward = tupleNormalize(DEFAULT_VIEW_DIRECTION);
  const right = tupleNormalize(tupleCross(WORLD_UP, backward));
  const cameraUp = tupleNormalize(tupleCross(backward, right));
  const verticalTangent = Math.tan((verticalFovDeg * Math.PI / 180) * 0.5);
  const horizontalTangent = verticalTangent * aspect;
  let distance = 0;

  for (const corner of boundsCorners(bounds)) {
    const offset = tupleSubtract(corner, center);
    const towardCamera = tupleDot(offset, backward);
    const horizontal = Math.abs(tupleDot(offset, right));
    const vertical = Math.abs(tupleDot(offset, cameraUp));
    distance = Math.max(
      distance,
      towardCamera + (horizontal * padding) / horizontalTangent,
      towardCamera + (vertical * padding) / verticalTangent
    );
  }

  distance = Math.max(distance, radius * 1.05);
  const position = tupleAdd(center, tupleScale(backward, distance));
  const near = Math.max(0.001, Math.min(radius * 0.02, distance * 0.05));
  const far = Math.max(10, distance + radius * 12);

  return {
    target: center,
    position,
    distance,
    minDistance: Math.max(0.05, radius * 0.35),
    maxDistance: Math.max(2, distance * 5, radius * 12),
    near,
    far
  };
}

function boundsCorners(bounds: SceneBounds): Vector3Tuple[] {
  const corners: Vector3Tuple[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
    }
  }
  return corners;
}

function tupleAdd(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function tupleSubtract(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function tupleScale(value: Vector3Tuple, scalar: number): Vector3Tuple {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function tupleDot(left: Vector3Tuple, right: Vector3Tuple) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function tupleCross(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function tupleLength(value: Vector3Tuple) {
  return Math.sqrt(tupleDot(value, value));
}

function tupleNormalize(value: Vector3Tuple): Vector3Tuple {
  const length = tupleLength(value);
  return length > 0 ? tupleScale(value, 1 / length) : [0, 0, 1];
}
