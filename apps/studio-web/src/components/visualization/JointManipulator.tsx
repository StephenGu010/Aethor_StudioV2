import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { signedRotationDeg, type Vector3Tuple } from '../../domain/jointInteraction';
import type { JointLike } from './robotModel';
import { acquireSceneResources } from './sceneResourceTracker';

interface DragSession {
  pointerId: number;
  originWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
  plane: THREE.Plane;
  startVector: THREE.Vector3;
  startTargetDeg: number;
  startClientX: number;
  startClientY: number;
  screenTangent: THREE.Vector2;
  cleanupListeners: () => void;
  releaseResource: () => void;
}

export function JointManipulator({
  joint,
  targetDeg,
  protocolIndex,
  onTargetChange,
  onDraggingChange
}: {
  joint: JointLike;
  targetDeg: number;
  protocolIndex: number;
  onTargetChange: (protocolIndex: number, valueDeg: number) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const { size, camera, gl } = useThree();
  const dragRef = useRef<DragSession | null>(null);
  const [hovered, setHovered] = useState(false);
  const axisOrientation = useMemo(() => {
    const axis = joint.axis?.clone().normalize() ?? new THREE.Vector3(0, 0, 1);
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  }, [joint]);

  useFrame((state) => {
    joint.updateWorldMatrix(true, false);
    const center = joint.localToWorld(new THREE.Vector3()).project(state.camera);
    const start = joint.localToWorld(
      new THREE.Vector3(0.052, 0, 0).applyQuaternion(axisOrientation)
    ).project(state.camera);
    const end = joint.localToWorld(
      new THREE.Vector3(0, 0.052, 0).applyQuaternion(axisOrientation)
    ).project(state.camera);
    const host = state.gl.domElement.closest<HTMLElement>('.robotSceneHost');
    if (!host) return;
    host.dataset.manipulatorReady = 'true';
    host.dataset.manipulatorStartX = String((start.x + 1) * state.size.width / 2);
    host.dataset.manipulatorStartY = String((1 - start.y) * state.size.height / 2);
    host.dataset.manipulatorEndX = String((end.x + 1) * state.size.width / 2);
    host.dataset.manipulatorEndY = String((1 - end.y) * state.size.height / 2);
    host.dataset.manipulatorCenterX = String((center.x + 1) * state.size.width / 2);
    host.dataset.manipulatorCenterY = String((1 - center.y) * state.size.height / 2);
  });

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.cleanupListeners();
    drag.releaseResource();
    dragRef.current = null;
    onDraggingChange(false);
    document.body.style.cursor = hovered ? 'grab' : '';
    const host = gl.domElement.closest<HTMLElement>('.robotSceneHost');
    if (host) host.dataset.dragState = 'idle';
  };

  useEffect(() => () => {
    dragRef.current?.cleanupListeners();
    dragRef.current?.releaseResource();
    dragRef.current = null;
    onDraggingChange(false);
    document.body.style.cursor = '';
    const host = document.querySelector<HTMLElement>('.robotSceneHost');
    if (host) {
      delete host.dataset.manipulatorReady;
      delete host.dataset.manipulatorStartX;
      delete host.dataset.manipulatorStartY;
      delete host.dataset.manipulatorEndX;
      delete host.dataset.manipulatorEndY;
      delete host.dataset.manipulatorCenterX;
      delete host.dataset.manipulatorCenterY;
      delete host.dataset.dragState;
    }
  }, [onDraggingChange]);

  const updateDragTarget = (ray: THREE.Ray, clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const currentPoint = intersectDragPlane(ray, drag.plane, drag.axisWorld);
    let deltaDeg: number | undefined;
    if (currentPoint) {
      const currentVector = currentPoint.sub(drag.originWorld);
      deltaDeg = signedRotationDeg(toTuple(drag.startVector), toTuple(currentVector), toTuple(drag.axisWorld));
    }
    if (deltaDeg === undefined) {
      const deltaPixels = new THREE.Vector2(
        clientX - drag.startClientX,
        clientY - drag.startClientY
      ).dot(drag.screenTangent);
      deltaDeg = THREE.MathUtils.radToDeg(deltaPixels / 84);
    }
    onTargetChange(protocolIndex, drag.startTargetDeg + deltaDeg);
  };

  const beginDrag = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const host = event.nativeEvent.currentTarget instanceof HTMLCanvasElement
      ? event.nativeEvent.currentTarget.closest<HTMLElement>('.robotSceneHost')
      : document.querySelector<HTMLElement>('.robotSceneHost');
    if (host) host.dataset.dragState = 'pointerdown';
    joint.updateWorldMatrix(true, false);
    const originWorld = joint.localToWorld(new THREE.Vector3());
    const worldQuaternion = joint.getWorldQuaternion(new THREE.Quaternion());
    const axisWorld = (joint.axis?.clone().normalize() ?? new THREE.Vector3(0, 0, 1))
      .applyQuaternion(worldQuaternion)
      .normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld, originWorld);
    const startPoint = intersectDragPlane(event.ray, plane, axisWorld) ?? event.point.clone();
    const startVector = startPoint.sub(originWorld).projectOnPlane(axisWorld);
    if (startVector.lengthSq() < 1e-8) {
      if (host) host.dataset.dragState = 'invalid-start-vector';
      return;
    }
    const tangentWorld = new THREE.Vector3().crossVectors(axisWorld, startVector).normalize();
    const screenTangent = projectWorldDirectionToScreen(originWorld, tangentWorld, event.camera, size.width, size.height);
    dragRef.current?.cleanupListeners();
    dragRef.current?.releaseResource();
    const session: DragSession = {
      pointerId: event.pointerId,
      originWorld,
      axisWorld,
      plane,
      startVector,
      startTargetDeg: targetDeg,
      startClientX: event.clientX,
      startClientY: event.clientY,
      screenTangent,
      cleanupListeners: () => undefined,
      releaseResource: acquireSceneResources({ dragSessions: 1 })
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== session.pointerId) return;
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(
        ((pointerEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((pointerEvent.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      updateDragTarget(raycaster.ray, pointerEvent.clientX, pointerEvent.clientY);
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === session.pointerId) finishDrag();
    };
    session.cleanupListeners = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    dragRef.current = session;
    if (host) host.dataset.dragState = 'active';
    onDraggingChange(true);
    document.body.style.cursor = 'grabbing';
  };

  const dragHandlers = {
    onPointerDown: beginDrag,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      setHovered(true);
      document.body.style.cursor = 'grab';
    },
    onPointerOut: () => {
      setHovered(false);
      if (!dragRef.current) document.body.style.cursor = '';
    }
  };

  return (
    <group quaternion={axisOrientation} renderOrder={20}>
      <mesh {...dragHandlers} raycast={manipulatorPriorityRaycast}>
        <torusGeometry args={[0.052, 0.014, 12, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.052, 0.0045, 12, 64]} />
        <meshBasicMaterial color={hovered ? '#ffe09a' : '#e0b95c'} transparent opacity={0.96} depthTest={false} />
      </mesh>
      <mesh position={[0.052, 0, 0]} {...dragHandlers} raycast={manipulatorPriorityRaycast}>
        <sphereGeometry args={[0.018, 16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
      <mesh position={[0.052, 0, 0]}>
        <sphereGeometry args={[0.006, 16, 12]} />
        <meshBasicMaterial color={hovered ? '#fff0c2' : '#e0b95c'} depthTest={false} />
      </mesh>
      <mesh position={[0, 0, 0.036]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.072, 10]} />
        <meshBasicMaterial color="#e0b95c" depthTest={false} />
      </mesh>
      <mesh position={[0, 0, 0.076]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.006, 0.014, 12]} />
        <meshBasicMaterial color="#e0b95c" depthTest={false} />
      </mesh>
    </group>
  );
}

function intersectDragPlane(ray: THREE.Ray, plane: THREE.Plane, axisWorld: THREE.Vector3) {
  if (Math.abs(ray.direction.dot(axisWorld)) < 0.035) return undefined;
  return ray.intersectPlane(plane, new THREE.Vector3()) ?? undefined;
}

function projectWorldDirectionToScreen(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number
) {
  const originNdc = origin.clone().project(camera);
  const tangentNdc = origin.clone().addScaledVector(direction, 0.08).project(camera);
  const result = new THREE.Vector2(
    (tangentNdc.x - originNdc.x) * width / 2,
    -(tangentNdc.y - originNdc.y) * height / 2
  );
  return result.lengthSq() > 1e-8 ? result.normalize() : new THREE.Vector2(1, 0);
}

function manipulatorPriorityRaycast(
  this: THREE.Mesh,
  raycaster: THREE.Raycaster,
  intersections: THREE.Intersection[]
) {
  const firstNewIntersection = intersections.length;
  THREE.Mesh.prototype.raycast.call(this, raycaster, intersections);
  for (let index = firstNewIntersection; index < intersections.length; index += 1) {
    const intersection = intersections[index];
    if (intersection) intersection.distance = -1;
  }
}

function toTuple(vector: THREE.Vector3): Vector3Tuple {
  return [vector.x, vector.y, vector.z];
}
