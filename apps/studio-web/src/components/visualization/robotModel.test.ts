import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import {
  applyJointPositions,
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
