import type { SceneBounds, Vector3Tuple } from './cameraFit';

export interface ReferenceGridLayout {
  size: number;
  divisions: number;
  position: Vector3Tuple;
  modelMinY: number;
  footprintSize: number;
  clearance: number;
}

const MINIMUM_GRID_SIZE = 6;
const GRID_MARGIN_FACTOR = 2;
const GRID_SIZE_STEP = 0.25;
const TARGET_CELL_SIZE = 0.125;

export function calculateReferenceGridLayout(bounds: SceneBounds): ReferenceGridLayout | null {
  const values = [...bounds.min, ...bounds.max];
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (bounds.max.some((value, index) => value < bounds.min[index]!)) return null;

  const width = bounds.max[0] - bounds.min[0];
  const height = bounds.max[1] - bounds.min[1];
  const depth = bounds.max[2] - bounds.min[2];
  const footprintSize = Math.max(width, depth);
  const size = roundUp(
    Math.max(MINIMUM_GRID_SIZE, footprintSize * GRID_MARGIN_FACTOR),
    GRID_SIZE_STEP
  );
  const clearance = clamp(height * 0.06, 0.08, 0.3);

  return {
    size,
    divisions: Math.round(clamp(size / TARGET_CELL_SIZE, 24, 80)),
    position: [
      (bounds.min[0] + bounds.max[0]) / 2,
      bounds.min[1] - clearance,
      (bounds.min[2] + bounds.max[2]) / 2
    ],
    modelMinY: bounds.min[1],
    footprintSize,
    clearance
  };
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
