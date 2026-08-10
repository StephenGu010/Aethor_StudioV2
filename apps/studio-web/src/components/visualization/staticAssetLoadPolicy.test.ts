import { describe, expect, it } from 'vitest';
import { shouldRetrySameOriginStaticAsset } from './staticAssetLoadPolicy';

const documentUrl = 'http://127.0.0.1:4173/console';

describe('same-origin static asset retry policy', () => {
  it('allows one retry for a same-origin network change or failed fetch', () => {
    expect(shouldRetrySameOriginStaticAsset({
      assetUrl: '/robot-profiles/aethor/model.urdf', documentUrl, attempt: 0,
      error: new TypeError('Failed to fetch')
    })).toBe(true);
    expect(shouldRetrySameOriginStaticAsset({
      assetUrl: 'http://127.0.0.1:4173/robot-profiles/aethor/mesh.stl', documentUrl, attempt: 0,
      error: { target: { status: 0 } }
    })).toBe(true);
  });

  it('does not retry external, HTTP, parse or repeated failures', () => {
    expect(shouldRetrySameOriginStaticAsset({
      assetUrl: 'https://example.com/mesh.stl', documentUrl, attempt: 0,
      error: new TypeError('Failed to fetch')
    })).toBe(false);
    expect(shouldRetrySameOriginStaticAsset({
      assetUrl: '/missing.stl', documentUrl, attempt: 0,
      error: { target: { status: 404 } }
    })).toBe(false);
    expect(shouldRetrySameOriginStaticAsset({
      assetUrl: '/broken.stl', documentUrl, attempt: 0,
      error: new Error('Unexpected token')
    })).toBe(false);
    expect(shouldRetrySameOriginStaticAsset({
      assetUrl: '/mesh.stl', documentUrl, attempt: 1,
      error: new TypeError('NetworkError when attempting to fetch resource')
    })).toBe(false);
  });
});
