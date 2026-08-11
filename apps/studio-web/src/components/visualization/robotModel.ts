import type { RobotProfileManifestV1 } from '@aethor/contracts';
import * as THREE from 'three';
import { resolveJointBindings } from '../../domain/jointInteraction';
import { deviceAngleToModelDeg } from '../../domain/jointCoordinates';
import type { SceneBounds } from './cameraFit';

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
  const actualJoints = collectJoints(loadedRobot);
  const targetJoints = collectJoints(target);
  const controlledJointNames = new Set(profile.joints.map((joint) => joint.urdfJointName));
  const ghostMaterials = new Map<string, THREE.MeshStandardMaterial>();
  target.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const owner = findOwningJointName(child, targetJoints);
    const materialKey = owner && controlledJointNames.has(owner) ? owner : 'uncontrolled';
    let material = ghostMaterials.get(materialKey);
    if (!material) {
      material = createGhostMaterial();
      ghostMaterials.set(materialKey, material);
    }
    mesh.material = material;
    if (isCollisionNode(child, target)) mesh.visible = false;
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
  positionsDeg: readonly number[],
  previousPositionsDeg?: readonly number[]
) {
  let appliedCount = 0;
  profile.joints.forEach((joint) => {
    const value = positionsDeg[joint.protocolIndex];
    if (value === undefined || value === previousPositionsDeg?.[joint.protocolIndex]) return;
    const targetJoint = joints.get(joint.urdfJointName);
    if (!targetJoint) return;
    targetJoint.setJointValue(THREE.MathUtils.degToRad(deviceAngleToModelDeg(joint, value)));
    appliedCount += 1;
  });
  return appliedCount;
}

export function applyVisibility(root: THREE.Object3D, showVisual: boolean, showCollision: boolean) {
  root.traverse((child) => {
    const typed = child as THREE.Object3D & { isURDFVisual?: boolean; isURDFCollider?: boolean };
    if (typed.isURDFVisual) typed.visible = showVisual;
    if (typed.isURDFCollider) typed.visible = showCollision;
  });
}

export function calculateLoadedModelBounds(
  models: LoadedModels,
  profile: RobotProfileManifestV1,
  focusGroupId?: string | null
): SceneBounds | null {
  const roots = resolveBoundsRoots(models, profile, focusGroupId);
  const bounds = new THREE.Box3();
  roots.forEach((root) => {
    root.updateWorldMatrix(true, true);
    bounds.union(new THREE.Box3().setFromObject(root));
  });
  if (bounds.isEmpty()) return null;
  return {
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z]
  };
}

function resolveBoundsRoots(
  models: LoadedModels,
  profile: RobotProfileManifestV1,
  focusGroupId?: string | null
) {
  if (!focusGroupId) return [models.actual, models.target];
  const group = profile.jointGroups?.find((candidate) => candidate.groupId === focusGroupId);
  if (!group) return [models.actual, models.target];
  const urdfJointNames = new Set(profile.joints
    .filter((joint) => group.jointIds.includes(joint.jointId))
    .map((joint) => joint.urdfJointName));
  const focusedRoots = [models.actualJoints, models.targetJoints]
    .flatMap((joints) => [...urdfJointNames]
      .map((jointName) => joints.get(jointName))
      .filter((joint): joint is JointLike => Boolean(joint)));
  return focusedRoots.length > 0 ? focusedRoots : [models.actual, models.target];
}

function collectJoints(root: THREE.Object3D): Map<string, JointLike> {
  const joints = new Map<string, JointLike>();
  root.traverse((child) => {
    const candidate = child as Partial<JointLike> & THREE.Object3D;
    if (typeof candidate.setJointValue === 'function') joints.set(child.name, candidate as JointLike);
  });
  return joints;
}

function isCollisionNode(object: THREE.Object3D, root: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if ((current as THREE.Object3D & { isURDFCollider?: boolean }).isURDFCollider) return true;
    if (current === root) return false;
    current = current.parent;
  }
  return false;
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
