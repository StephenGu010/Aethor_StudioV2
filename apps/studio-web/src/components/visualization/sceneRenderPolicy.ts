import type { SceneQuality } from './sceneCapabilities';

const BALANCED_FRAMEBUFFER_PIXEL_BUDGET = 3_500_000;
const CONSTRAINED_FRAMEBUFFER_PIXEL_BUDGET = 1_800_000;
const BALANCED_MAX_DPR = 1.75;
const CONSTRAINED_MAX_DPR = 1.2;

export interface SceneDprInput {
  width: number;
  height: number;
  devicePixelRatio: number;
  quality: SceneQuality;
}

/**
 * Caps framebuffer pixels instead of applying the same DPR to every monitor.
 * The CSS layout is unchanged; only GPU raster density is reduced when a large
 * or high-DPI canvas would otherwise create an unnecessarily expensive buffer.
 */
export function calculateSceneDevicePixelRatio(input: SceneDprInput) {
  const width = finitePositive(input.width, 1);
  const height = finitePositive(input.height, 1);
  const devicePixelRatio = finitePositive(input.devicePixelRatio, 1);
  const constrained = input.quality === 'constrained';
  const maximumDpr = constrained ? CONSTRAINED_MAX_DPR : BALANCED_MAX_DPR;
  const pixelBudget = constrained
    ? CONSTRAINED_FRAMEBUFFER_PIXEL_BUDGET
    : BALANCED_FRAMEBUFFER_PIXEL_BUDGET;
  const budgetDpr = Math.sqrt(pixelBudget / (width * height));
  const resolved = Math.min(devicePixelRatio, maximumDpr, Math.max(1, budgetDpr));
  return Math.round(Math.max(1, resolved) * 1000) / 1000;
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
