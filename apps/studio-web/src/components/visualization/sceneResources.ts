import * as THREE from 'three';

export interface DisposedSceneResources {
  geometries: number;
  materials: number;
  textures: number;
}

export function inspectObjectGraphs(roots: Iterable<THREE.Object3D>): DisposedSceneResources {
  const resources = collectObjectGraphResources(roots);
  return {
    geometries: resources.geometries.size,
    materials: resources.materials.size,
    textures: resources.textures.size
  };
}

export function disposeObjectGraphs(roots: Iterable<THREE.Object3D>): DisposedSceneResources {
  const resources = collectObjectGraphResources(roots);
  resources.textures.forEach((texture) => texture.dispose());
  resources.materials.forEach((material) => material.dispose());
  resources.geometries.forEach((geometry) => geometry.dispose());
  return {
    geometries: resources.geometries.size,
    materials: resources.materials.size,
    textures: resources.textures.size
  };
}

function collectObjectGraphResources(roots: Iterable<THREE.Object3D>) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  for (const root of roots) {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const childMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      childMaterials.forEach((material) => {
        materials.add(material);
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) textures.add(value);
        });
      });
    });
  }

  return { geometries, materials, textures };
}
