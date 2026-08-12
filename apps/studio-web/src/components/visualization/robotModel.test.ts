import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import {
  applyJointPositions,
  applyActualJointAvailability,
  calculateLoadedModelBounds,
  createLoadedModels,
  type JointLike,
  type LoadedModels,
  updateTargetHighlight
} from './robotModel';

const disposableMeshes: THREE.Mesh[] = [];

afterEach(() => {
  disposableMeshes.splice(0).forEach((mesh) => {
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material.dispose());
  });
});

describe('loaded robot model bounds', () => {
  it('focuses a declared joint group without changing the full-model bounds', () => {
    const models = createDualArmFixture();

    const full = calculateLoadedModelBounds(models, aethorRoboProfile, null);
    const left = calculateLoadedModelBounds(models, aethorRoboProfile, 'left-arm');
    const right = calculateLoadedModelBounds(models, aethorRoboProfile, 'right-arm');

    expect(full).toMatchObject({ min: [-5.5, -0.5, -0.5], max: [5.5, 1.5, 0.5] });
    expect(left).toMatchObject({ min: [-5.5, -0.5, -0.5], max: [-4.5, 1.5, 0.5] });
    expect(right).toMatchObject({ min: [4.5, -0.5, -0.5], max: [5.5, 1.5, 0.5] });
  });

  it('falls back to full-model bounds for an unknown focus group', () => {
    const models = createDualArmFixture();
    expect(calculateLoadedModelBounds(models, aethorRoboProfile, 'unknown-group'))
      .toEqual(calculateLoadedModelBounds(models, aethorRoboProfile, null));
  });
});

describe('joint pose updates', () => {
  it('applies only changed joints after the initial pose', () => {
    const calls = new Map<string, number[]>();
    const joints = new Map<string, JointLike>();
    aethorRoboProfile.joints.forEach((profileJoint) => {
      const joint = new THREE.Object3D() as JointLike;
      joint.setJointValue = (value) => {
        const values = calls.get(profileJoint.urdfJointName) ?? [];
        values.push(value);
        calls.set(profileJoint.urdfJointName, values);
      };
      joints.set(profileJoint.urdfJointName, joint);
    });
    const initial = Array(aethorRoboProfile.model.dof).fill(0);
    const changed = [...initial];
    changed[3] = 45;

    expect(applyJointPositions(joints, aethorRoboProfile, initial)).toBe(14);
    expect(applyJointPositions(joints, aethorRoboProfile, changed, initial)).toBe(1);
    expect(applyJointPositions(joints, aethorRoboProfile, changed, changed)).toBe(0);
    expect(calls.get(aethorRoboProfile.joints[3]!.urdfJointName)).toEqual([0, Math.PI / 4]);
    expect(calls.get(aethorRoboProfile.joints[0]!.urdfJointName)).toEqual([0]);
  });

  it('renders Dummy J3=90 from #GETJPOS at the URDF zero angle', () => {
    const calls: number[] = [];
    const j3 = dummyProfile.joints[2]!;
    const modelJoint = new THREE.Object3D() as JointLike;
    modelJoint.setJointValue = (value) => calls.push(value);

    expect(applyJointPositions(
      new Map([[j3.urdfJointName, modelJoint]]),
      dummyProfile,
      [0, 0, 90, 0, 0, 0]
    )).toBe(1);
    expect(calls).toEqual([0]);
  });
});

describe('target preview rendering', () => {
  it('shares one ghost material per controlled joint and never renders target collision meshes', () => {
    const source = new THREE.Object3D();
    const baseMesh = namedMesh('base-preview');
    source.add(baseMesh);
    aethorRoboProfile.joints.forEach((profileJoint, index) => {
      const joint = new TestJoint();
      joint.name = profileJoint.urdfJointName;
      if (index === 0) {
        joint.add(namedMesh('joint-visual'));
        const collision = new TestCollider();
        collision.add(namedMesh('joint-collision'));
        joint.add(collision);
      }
      source.add(joint);
    });

    const models = createLoadedModels(source, aethorRoboProfile);
    const targetMeshes = new Map<string, THREE.Mesh>();
    const targetMaterials = new Set<THREE.Material>();
    models.target.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      targetMeshes.set(mesh.name, mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => targetMaterials.add(material));
    });

    try {
      expect(targetMaterials.size).toBe(2);
      expect(targetMeshes.get('joint-visual')?.material)
        .toBe(targetMeshes.get('joint-collision')?.material);
      expect(targetMeshes.get('joint-collision')?.visible).toBe(false);

      updateTargetHighlight(
        models.target,
        models.targetJoints,
        aethorRoboProfile.joints[0]!.jointId,
        aethorRoboProfile
      );
      expect((targetMeshes.get('joint-visual')?.material as THREE.MeshStandardMaterial).opacity).toBe(0.45);
      expect((targetMeshes.get('base-preview')?.material as THREE.MeshStandardMaterial).opacity).toBe(0.18);
    } finally {
      targetMaterials.forEach((material) => material.dispose());
    }
  });
});

describe('partial motor availability rendering', () => {
  it('replaces only the declared uncertain joint chain material and can restore it', () => {
    const source = new THREE.Object3D();
    const meshes = new Map<string, THREE.Mesh>();
    aethorRoboProfile.joints.forEach((profileJoint) => {
      const joint = new TestJoint();
      joint.name = profileJoint.urdfJointName;
      const mesh = namedMesh(`${profileJoint.jointId}-actual`);
      meshes.set(profileJoint.jointId, mesh);
      joint.add(mesh);
      source.add(joint);
    });
    const models = createLoadedModels(source, aethorRoboProfile);
    const unavailable = new THREE.MeshStandardMaterial({ color: '#4b5258' });
    const originalJ2 = meshes.get('j2')?.material;
    const originalRightJ1 = meshes.get('j8')?.material;

    try {
      expect(applyActualJointAvailability(
        models,
        aethorRoboProfile,
        new Set(['j3', 'j4', 'j5', 'j6', 'j7']),
        unavailable
      )).toBe(5);
      expect(meshes.get('j2')?.material).toBe(originalJ2);
      expect(meshes.get('j3')?.material).toBe(unavailable);
      expect(meshes.get('j7')?.material).toBe(unavailable);
      expect(meshes.get('j8')?.material).toBe(originalRightJ1);

      applyActualJointAvailability(models, aethorRoboProfile, new Set());
      expect(meshes.get('j3')?.material).not.toBe(unavailable);
    } finally {
      unavailable.dispose();
      disposeModelMaterials(models);
    }
  });
});

function createDualArmFixture(): LoadedModels {
  const actual = new THREE.Object3D();
  const target = new THREE.Object3D();
  const actualLeft = jointWithBox('left_arm_joint_1', -5, 0);
  const actualRight = jointWithBox('right_arm_joint_1', 5, 0);
  const targetLeft = jointWithBox('left_arm_joint_1', -5, 1);
  const targetRight = jointWithBox('right_arm_joint_1', 5, 1);
  actual.add(actualLeft, actualRight);
  target.add(targetLeft, targetRight);
  return {
    actual,
    target,
    actualJoints: new Map([[actualLeft.name, actualLeft], [actualRight.name, actualRight]]),
    targetJoints: new Map([[targetLeft.name, targetLeft], [targetRight.name, targetRight]])
  };
}

function jointWithBox(name: string, x: number, y: number): JointLike {
  const joint = new THREE.Object3D() as JointLike;
  joint.name = name;
  joint.setJointValue = () => undefined;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, 0);
  disposableMeshes.push(mesh);
  joint.add(mesh);
  return joint;
}

class TestJoint extends THREE.Object3D implements JointLike {
  setJointValue() {
  }
}

class TestCollider extends THREE.Object3D {
  readonly isURDFCollider = true;
}

function namedMesh(name: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.name = name;
  disposableMeshes.push(mesh);
  return mesh;
}

function disposeModelMaterials(models: LoadedModels) {
  const materials = new Set<THREE.Material>();
  models.target.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .forEach((material) => materials.add(material));
  });
  materials.forEach((material) => material.dispose());
}
