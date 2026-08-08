import { describe, expect, it } from 'vitest';
import { evaluateSceneCapabilities } from './sceneCapabilities';

describe('scene capability policy', () => {
  it('fails explicitly when WebGL is unavailable', () => {
    expect(evaluateSceneCapabilities({ webglAvailable: false, prefersReducedMotion: false }))
      .toEqual({ supported: false, quality: 'constrained', reason: 'WEBGL_UNAVAILABLE' });
  });

  it('reduces scene cost without claiming a model failure', () => {
    expect(evaluateSceneCapabilities({
      webglAvailable: true,
      hardwareConcurrency: 4,
      prefersReducedMotion: false
    })).toEqual({ supported: true, quality: 'constrained', reason: 'LIMITED_CPU' });
  });

  it('uses balanced quality on a capable workstation', () => {
    expect(evaluateSceneCapabilities({
      webglAvailable: true,
      hardwareConcurrency: 12,
      prefersReducedMotion: false
    })).toEqual({ supported: true, quality: 'balanced' });
  });
});
