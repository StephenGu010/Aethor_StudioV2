import type { RobotProfileManifestV1 } from '@aethor/contracts';
import * as THREE from 'three';
import { resolveJointBindings } from '../../domain/jointInteraction';

export interface LoadedModels {
  actual: THREE.Object3D;
  target: THREE.Object3D;
  actualJoints: Map<string, JointLike>;
  targetJoints: Map<string, JointLike>;
}

export interface JointLike extends THREE.Object3D {
  axis?: THREE.Vector3;
  setJointValue: (value: number) => void;
}

export function createLoadedModels(
  loadedRobot: THREE.Object3D,
  profile: RobotProfileManifestV1
): LoadedModels {
  const target = loadedRobot.clone(true);
  target.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = createGhostMaterial();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 3;
  });
  loadedRobot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  const actualJoints = collectJoints(loadedRobot);
  const targetJoints = collectJoints(target);
  resolveJointBindings(profile, actualJoints.keys());
  resolveJointBindings(profile, targetJoints.keys());
  return { actual: loadedRobot, target, actualJoints, targetJoints };
}

export function updateTargetHighlight(
  targetRoot: THREE.Object3D,
  targetJoints: Map<string, JointLike>,
  selectedJointId: string,
  profile: RobotProfileManifestV1
) {
  const selectedJoint = profile.joints.find((joint) => joint.jointId === selectedJointId);
  targetRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const owner = findOwningJointName(child, targetJoints);
    const selected = owner === selectedJoint?.urdfJointName;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      material.color.set(selected ? '#f4d17a' : '#b6d3df');
      material.emissive.set(selected ? '#b98424' : '#6f9fb2');
      material.emissiveIntensity = selected ? 0.72 : 0.28;
      material.opacity = selected ? 0.45 : 0.18;
    });
  });
}

export function findOwningJointName(object: THREE.Object3D, joints: Map<string, JointLike>) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (joints.get(current.name) === current) return current.name;
    current = current.parent;
  }
  return undefined;
}

export function applyJointPositions(
  joints: Map<string, JointLike>,
  profile: RobotProfileManifestV1,
  positionsDeg: number[]
) {
  profile.joints.forEach((joint) => {
    const value = positionsDeg[joint.protocolIndex];
    if (value !== undefined) joints.get(joint.urdfJointName)?.setJointValue(THREE.MathUtils.degToRad(value));
  });
}

export function applyVisibility(root: THREE.Object3D, showVisual: boolean, showCollision: boolean) {
  root.traverse((child) => {
    const typed = child as THREE.Object3D & { isURDFVisual?: boolean; isURDFCollider?: boolean };
    if (typed.isURDFVisual) typed.visible = showVisual;
    if (typed.isURDFCollider) typed.visible = showCollision;
  });
}

function collectJoints(root: THREE.Object3D): Map<string, JointLike> {
  const joints = new Map<string, JointLike>();
  root.traverse((child) => {
    const candidate = child as Partial<JointLike> & THREE.Object3D;
    if (typeof candidate.setJointValue === 'function') joints.set(child.name, candidate as JointLike);
  });
  return joints;
}

function createGhostMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#b6d3df',
    emissive: '#6f9fb2',
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.18,
    wireframe: true,
    depthWrite: false
  });
}
