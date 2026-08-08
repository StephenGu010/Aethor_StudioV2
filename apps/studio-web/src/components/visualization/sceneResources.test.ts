import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { acquireSceneResources, getSceneResourceSnapshot } from './sceneResourceTracker';
import { disposeObjectGraphs } from './sceneResources';

describe('scene resource ownership', () => {
  it('tracks acquisition with idempotent release', () => {
    const before = getSceneResourceSnapshot();
    const release = acquireSceneResources({ renderers: 1, controls: 1, modelRoots: 2 });
    expect(getSceneResourceSnapshot()).toEqual({
      ...before,
      renderers: before.renderers + 1,
      controls: before.controls + 1,
      modelRoots: before.modelRoots + 2
    });
    release();
    release();
    expect(getSceneResourceSnapshot()).toEqual(before);
  });

  it('disposes shared geometry and texture exactly once across actual and target roots', () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const actualMaterial = new THREE.MeshStandardMaterial({ map: texture });
    const targetMaterial = new THREE.MeshStandardMaterial({ map: texture });
    const actual = new THREE.Group();
    const target = new THREE.Group();
    actual.add(new THREE.Mesh(geometry, actualMaterial));
    target.add(new THREE.Mesh(geometry, targetMaterial));
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    const actualMaterialDispose = vi.spyOn(actualMaterial, 'dispose');
    const targetMaterialDispose = vi.spyOn(targetMaterial, 'dispose');

    expect(disposeObjectGraphs([actual, target])).toEqual({ geometries: 1, materials: 2, textures: 1 });
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(actualMaterialDispose).toHaveBeenCalledOnce();
    expect(targetMaterialDispose).toHaveBeenCalledOnce();
  });
});
