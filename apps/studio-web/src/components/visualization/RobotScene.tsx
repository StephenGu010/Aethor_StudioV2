import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader from 'urdf-loader';
import type { RobotProfileManifestV1 } from '@aethor/contracts';

interface RobotSceneProps {
  profile: RobotProfileManifestV1;
  urdfUrl: string;
  actualPositionsDeg: number[];
  targetPositionsDeg: number[];
  cameraResetSignal: number;
  settings: {
    showVisual: boolean;
    showCollision: boolean;
    showGrid: boolean;
    showShadows: boolean;
    showLighting: boolean;
    showBaseFrame: boolean;
    showTcpFrame: boolean;
    showJointAxes: boolean;
  };
  onModelState: (state: 'loading' | 'ready' | 'error') => void;
}

interface LoadedModels {
  actual: THREE.Object3D;
  target: THREE.Object3D;
  actualJoints: Map<string, JointLike>;
  targetJoints: Map<string, JointLike>;
  ghostMaterials: THREE.Material[];
}

interface JointLike extends THREE.Object3D {
  setJointValue: (value: number) => void;
}

export function RobotScene(props: RobotSceneProps) {
  return (
    <Canvas
      shadows={props.settings.showShadows}
      camera={{ position: [0.78, 0.58, 0.84], fov: 39, near: 0.01, far: 40 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#080a0c']} />
      <fog attach="fog" args={['#080a0c', 2.8, 7]} />
      <SceneLighting enabled={props.settings.showLighting} shadows={props.settings.showShadows} />
      <CameraController resetSignal={props.cameraResetSignal} />
      {props.settings.showGrid && <GridFloor />}
      {props.settings.showBaseFrame && <Axes scale={0.12} position={[-0.38, -0.001, 0.3]} />}
      <RobotModels {...props} />
    </Canvas>
  );
}

function SceneLighting({ enabled, shadows }: { enabled: boolean; shadows: boolean }) {
  if (!enabled) return <ambientLight intensity={1.15} />;
  return (
    <>
      <ambientLight intensity={0.54} />
      <hemisphereLight args={['#aab7c2', '#111419', 0.82]} />
      <directionalLight
        castShadow={shadows}
        position={[1.3, 1.8, 1.1]}
        intensity={2.2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-1.1, 0.7, -0.5]} intensity={0.72} color="#85a1b4" />
    </>
  );
}

function CameraController({ resetSignal }: { resetSignal: number }) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.target.set(0, 0.18, 0);
    controls.minDistance = 0.35;
    controls.maxDistance = 4.5;
    controls.maxPolarAngle = Math.PI * 0.89;
    controls.update();
    controlsRef.current = controls;
    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl.domElement]);

  useEffect(() => {
    camera.position.set(0.78, 0.58, 0.84);
    controlsRef.current?.target.set(0, 0.18, 0);
    controlsRef.current?.update();
  }, [camera, resetSignal]);

  useFrame(() => controlsRef.current?.update());
  return null;
}

function GridFloor() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(1.8, 36, '#30363d', '#171b20');
    helper.position.y = -0.001;
    const material = helper.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.62;
    return helper;
  }, []);
  useEffect(() => () => {
    grid.geometry.dispose();
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material) => material.dispose());
  }, [grid]);
  return <primitive object={grid} />;
}

function Axes({ scale, position }: { scale: number; position?: [number, number, number] }) {
  const axes = useMemo(() => new THREE.AxesHelper(scale), [scale]);
  useEffect(() => () => {
    axes.geometry.dispose();
    const materials = Array.isArray(axes.material) ? axes.material : [axes.material];
    materials.forEach((material) => material.dispose());
  }, [axes]);
  return <primitive object={axes} position={position} />;
}

function RobotModels(props: RobotSceneProps) {
  const [models, setModels] = useState<LoadedModels | null>(null);

  useEffect(() => {
    let cancelled = false;
    props.onModelState('loading');
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);
    loader.parseCollision = true;
    loader.loadMeshCb = (path, loadManager, _urdfMaterial, done) => {
      new STLLoader(loadManager).load(
        path,
        (geometry) => {
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: '#b8bdc2',
            metalness: 0.48,
            roughness: 0.34
          });
          done(new THREE.Mesh(geometry, material));
        },
        undefined,
        (error) => done(new THREE.Object3D(), error instanceof Error ? error : new Error(String(error)))
      );
    };
    loader.load(
      props.urdfUrl,
      (loadedRobot) => {
        if (cancelled) {
          disposeRoot(loadedRobot);
          return;
        }
        const target = loadedRobot.clone(true);
        const ghostMaterials: THREE.Material[] = [];
        target.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          const ghost = new THREE.MeshStandardMaterial({
            color: '#b6d3df',
            emissive: '#6f9fb2',
            emissiveIntensity: 0.28,
            transparent: true,
            opacity: 0.18,
            wireframe: true,
            depthWrite: false
          });
          mesh.material = ghost;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.renderOrder = 3;
          ghostMaterials.push(ghost);
        });
        loadedRobot.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        setModels({
          actual: loadedRobot,
          target,
          actualJoints: collectJoints(loadedRobot),
          targetJoints: collectJoints(target),
          ghostMaterials
        });
        props.onModelState('ready');
      },
      undefined,
      () => {
        if (!cancelled) props.onModelState('error');
      }
    );

    return () => {
      cancelled = true;
      setModels((current) => {
        if (current) {
          disposeRoot(current.actual);
          current.ghostMaterials.forEach((material) => material.dispose());
        }
        return null;
      });
    };
  }, [props.profile.profileId, props.urdfUrl]);

  useEffect(() => {
    if (!models) return;
    applyJointPositions(models.actualJoints, props.profile, props.actualPositionsDeg);
    applyJointPositions(models.targetJoints, props.profile, props.targetPositionsDeg);
  }, [models, props.actualPositionsDeg, props.profile, props.targetPositionsDeg]);

  useEffect(() => {
    if (!models) return;
    applyVisibility(models.actual, props.settings.showVisual, props.settings.showCollision);
    models.actualJoints.forEach((joint) => {
      const marker = joint.getObjectByName('aethor-joint-axis');
      if (marker) marker.visible = props.settings.showJointAxes;
    });
    const tcp = models.actual.getObjectByName('aethor-tcp-axis');
    if (tcp) tcp.visible = props.settings.showTcpFrame;
  }, [
    models,
    props.settings.showCollision,
    props.settings.showJointAxes,
    props.settings.showTcpFrame,
    props.settings.showVisual
  ]);

  useEffect(() => {
    if (!models) return;
    models.actualJoints.forEach((joint) => {
      if (joint.getObjectByName('aethor-joint-axis')) return;
      const axes = new THREE.AxesHelper(0.032);
      axes.name = 'aethor-joint-axis';
      axes.visible = props.settings.showJointAxes;
      joint.add(axes);
    });
    const tcpLink = models.actual.getObjectByName('link_6');
    if (tcpLink && !tcpLink.getObjectByName('aethor-tcp-axis')) {
      const tcpAxes = new THREE.AxesHelper(0.085);
      tcpAxes.name = 'aethor-tcp-axis';
      tcpAxes.visible = props.settings.showTcpFrame;
      tcpLink.add(tcpAxes);
    }
  }, [models, props.settings.showJointAxes, props.settings.showTcpFrame]);

  if (!models) return <LoadingSkeleton />;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <primitive object={models.actual} />
      <primitive object={models.target} />
    </group>
  );
}

function collectJoints(root: THREE.Object3D): Map<string, JointLike> {
  const joints = new Map<string, JointLike>();
  root.traverse((child) => {
    const candidate = child as Partial<JointLike> & THREE.Object3D;
    if (typeof candidate.setJointValue === 'function') joints.set(child.name, candidate as JointLike);
  });
  return joints;
}

function applyJointPositions(
  joints: Map<string, JointLike>,
  profile: RobotProfileManifestV1,
  positionsDeg: number[]
) {
  profile.joints.forEach((joint) => {
    const value = positionsDeg[joint.protocolIndex];
    if (value !== undefined) joints.get(joint.urdfJointName)?.setJointValue(THREE.MathUtils.degToRad(value));
  });
}

function applyVisibility(root: THREE.Object3D, showVisual: boolean, showCollision: boolean) {
  root.traverse((child) => {
    const typed = child as THREE.Object3D & { isURDFVisual?: boolean; isURDFCollider?: boolean };
    if (typed.isURDFVisual) typed.visible = showVisual;
    if (typed.isURDFCollider) typed.visible = showCollision;
  });
}

function disposeRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => materials.add(item));
    else if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function LoadingSkeleton() {
  return (
    <group position={[0, 0.18, 0]}>
      <mesh>
        <cylinderGeometry args={[0.08, 0.11, 0.12, 20]} />
        <meshStandardMaterial color="#454c53" wireframe />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.05, 0.28, 0.05]} />
        <meshStandardMaterial color="#68737c" wireframe />
      </mesh>
      <mesh position={[0.1, 0.28, 0]} rotation={[0, 0, -0.75]}>
        <boxGeometry args={[0.04, 0.27, 0.04]} />
        <meshStandardMaterial color="#68737c" wireframe />
      </mesh>
    </group>
  );
}
