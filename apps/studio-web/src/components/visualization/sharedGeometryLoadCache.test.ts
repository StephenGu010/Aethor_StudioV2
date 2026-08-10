import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SharedGeometryLoadCache } from './sharedGeometryLoadCache';

describe('SharedGeometryLoadCache', () => {
  it('fans one in-flight geometry load out to every visual/collision subscriber', () => {
    const pending = new Map<string, {
      resolve: (geometry: THREE.BufferGeometry) => void;
      reject: (error: unknown) => void;
    }>();
    const load = vi.fn((assetUrl, resolve, reject) => pending.set(assetUrl, { resolve, reject }));
    const cache = new SharedGeometryLoadCache(load);
    const first = vi.fn();
    const second = vi.fn();
    const firstError = vi.fn();
    const secondError = vi.fn();

    cache.request('/arm.stl', { onLoad: first, onError: firstError });
    cache.request('/arm.stl', { onLoad: second, onError: secondError });
    const geometry = new THREE.BufferGeometry();
    pending.get('/arm.stl')?.resolve(geometry);

    expect(load).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith(geometry);
    expect(second).toHaveBeenCalledWith(geometry);
    expect(firstError).not.toHaveBeenCalled();
    expect(secondError).not.toHaveBeenCalled();
    geometry.dispose();
  });

  it('reuses a completed geometry without starting another load', () => {
    const geometry = new THREE.BufferGeometry();
    const load = vi.fn((_assetUrl, resolve) => resolve(geometry));
    const cache = new SharedGeometryLoadCache(load);
    const first = vi.fn();
    const second = vi.fn();

    cache.request('/arm.stl', { onLoad: first, onError: vi.fn() });
    cache.request('/arm.stl', { onLoad: second, onError: vi.fn() });

    expect(load).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith(geometry);
    expect(second).toHaveBeenCalledWith(geometry);
    geometry.dispose();
  });

  it('evicts a failed entry so the bounded caller retry starts one fresh load', () => {
    const attempts: Array<{
      resolve: (geometry: THREE.BufferGeometry) => void;
      reject: (error: unknown) => void;
    }> = [];
    const load = vi.fn((_assetUrl, resolve, reject) => attempts.push({ resolve, reject }));
    const cache = new SharedGeometryLoadCache(load);
    const firstError = vi.fn();
    const secondError = vi.fn();

    cache.request('/arm.stl', { onLoad: vi.fn(), onError: firstError });
    cache.request('/arm.stl', { onLoad: vi.fn(), onError: secondError });
    attempts[0]?.reject(new Error('network changed'));
    cache.request('/arm.stl', { onLoad: vi.fn(), onError: vi.fn() });

    expect(load).toHaveBeenCalledTimes(2);
    expect(firstError).toHaveBeenCalledOnce();
    expect(secondError).toHaveBeenCalledOnce();
  });

  it('turns a synchronous loader failure into the same observable error path', () => {
    const failure = new Error('loader setup failed');
    const cache = new SharedGeometryLoadCache(() => { throw failure; });
    const onError = vi.fn();

    cache.request('/arm.stl', { onLoad: vi.fn(), onError });

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
