export type SceneQuality = 'balanced' | 'constrained';

export interface SceneCapabilityState {
  supported: boolean;
  quality: SceneQuality;
  reason?: 'WEBGL_UNAVAILABLE' | 'REDUCED_MOTION' | 'LIMITED_CPU';
}

export interface SceneEnvironmentProbe {
  webglAvailable: boolean;
  hardwareConcurrency?: number;
  prefersReducedMotion: boolean;
}

export function evaluateSceneCapabilities(probe: SceneEnvironmentProbe): SceneCapabilityState {
  if (!probe.webglAvailable) {
    return { supported: false, quality: 'constrained', reason: 'WEBGL_UNAVAILABLE' };
  }
  if (probe.prefersReducedMotion) {
    return { supported: true, quality: 'constrained', reason: 'REDUCED_MOTION' };
  }
  if (probe.hardwareConcurrency !== undefined && probe.hardwareConcurrency <= 4) {
    return { supported: true, quality: 'constrained', reason: 'LIMITED_CPU' };
  }
  return { supported: true, quality: 'balanced' };
}

export function detectSceneCapabilities(): SceneCapabilityState {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, quality: 'constrained', reason: 'WEBGL_UNAVAILABLE' };
  }
  return evaluateSceneCapabilities({
    webglAvailable: 'WebGL2RenderingContext' in window || 'WebGLRenderingContext' in window,
    hardwareConcurrency: navigator.hardwareConcurrency,
    prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  });
}
