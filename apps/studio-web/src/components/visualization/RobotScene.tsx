import { Canvas, createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import {
  Component,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader from 'urdf-loader';
import type { RobotProfileManifestV1 } from '@aethor/contracts';
import { JointManipulator } from './JointManipulator';
import {
  applyJointPositions,
  applyVisibility,
  createLoadedModels,
  findOwningJointName,
  type JointLike,
  type LoadedModels,
  updateTargetHighlight
} from './robotModel';
import { detectSceneCapabilities, type SceneCapabilityState } from './sceneCapabilities';
import { disposeObjectGraphs, inspectObjectGraphs } from './sceneResources';
import { acquireSceneResources } from './sceneResourceTracker';

interface RobotSceneProps {
  profile: RobotProfileManifestV1;
  urdfUrl: string;
  actualPositionsDeg: number[];
  targetPositionsDeg: number[];
  selectedJointId: string;
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
  onSelectedJointChange: (jointId: string) => void;
  onJointTargetChange: (protocolIndex: number, valueDeg: number) => void;
  onModelState: (state: 'loading' | 'ready' | 'error') => void;
  onCapabilityState: (state: SceneCapabilityState) => void;
}

export function RobotScene(props: RobotSceneProps) {
  const capability = useMemo(detectSceneCapabilities, []);
  const [runtimeFailure, setRuntimeFailure] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    props.onCapabilityState(capability);
    if (!capability.supported) props.onModelState('error');
  }, [capability, props.onCapabilityState, props.onModelState]);

  const handleRuntimeFailure = useCallback(() => {
    setRuntimeFailure(true);
    draggingRef.current = false;
    props.onModelState('error');
  }, [props.onModelState]);
  const handleDraggingChange = useCallback((dragging: boolean) => {
    draggingRef.current = dragging;
  }, []);

  if (!capability.supported || runtimeFailure) {
    return <SceneFallback reason={runtimeFailure ? 'WEBGL CONTEXT LOST' : 'WEBGL UNAVAILABLE'} />;
  }

  const constrained = capability.quality === 'constrained';
  const shadowsEnabled = props.settings.showShadows && !constrained;

  return (
    <div className="robotSceneHost" data-scene-quality={capability.quality}>
      <SceneErrorBoundary onError={handleRuntimeFailure}>
        <Canvas
          fallback={<SceneFallback reason="WEBGL INITIALIZATION FAILED" />}
          shadows={shadowsEnabled ? 'percentage' : false}
          camera={{ position: [0.78, 0.58, 0.84], fov: 39, near: 0.01, far: 40 }}
          dpr={constrained ? [1, 1.2] : [1, 1.75]}
          gl={{ antialias: !constrained, powerPreference: constrained ? 'default' : 'high-performance' }}
        >
          <RendererLifecycle onContextLost={handleRuntimeFailure} />
          <color attach="background" args={['#080a0c']} />
          <fog attach="fog" args={['#080a0c', 2.8, 7]} />
          <SceneLighting enabled={props.settings.showLighting} shadows={shadowsEnabled} />
          <CameraController resetSignal={props.cameraResetSignal} draggingRef={draggingRef} />
          {props.settings.showGrid && <GridFloor />}
          {props.settings.showBaseFrame && <Axes scale={0.12} position={[-0.38, -0.001, 0.3]} />}
          <RobotModels {...props} onDraggingChange={handleDraggingChange} />
        </Canvas>
      </SceneErrorBoundary>
      {constrained && (
        <div className="sceneQualityNotice" role="status">
          PERFORMANCE LIMITED · DPR / SHADOWS REDUCED
        </div>
      )}
    </div>
  );
}

function RendererLifecycle({ onContextLost }: { onContextLost: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const release = acquireSceneResources({ renderers: 1 });
    const canvas = gl.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      release();
    };
  }, [gl.domElement, onContextLost]);
  return null;
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
        shadow-mapSize-width={shadows ? 2048 : 512}
        shadow-mapSize-height={shadows ? 2048 : 512}
      />
      <directionalLight position={[-1.1, 0.7, -0.5]} intensity={0.72} color="#85a1b4" />
    </>
  );
}

function CameraController({
  resetSignal,
  draggingRef
}: {
  resetSignal: number;
  draggingRef: MutableRefObject<boolean>;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    const release = acquireSceneResources({ controls: 1 });
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
      release();
    };
  }, [camera, gl.domElement]);

  useEffect(() => {
    camera.position.set(0.78, 0.58, 0.84);
    controlsRef.current?.target.set(0, 0.18, 0);
    controlsRef.current?.update();
  }, [camera, resetSignal]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.enabled = !draggingRef.current;
    controls.update();
  });
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

function RobotModels(props: RobotSceneProps & { onDraggingChange: (dragging: boolean) => void }) {
  const [models, setModels] = useState<LoadedModels | null>(null);
  const readyFrameCount = useRef(0);

  useFrame(() => {
    if (!models || readyFrameCount.current >= 2) return;
    readyFrameCount.current += 1;
    if (readyFrameCount.current === 2) props.onModelState('ready');
  });

  useEffect(() => {
    let cancelled = false;
    let loadFailed = false;
    let resourcesLoaded = false;
    let parsedRobot: THREE.Object3D | null = null;
    let ownedModels: LoadedModels | null = null;
    setModels(null);
    props.onModelState('loading');
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);

    const finalizeLoadedModels = () => {
      if (!resourcesLoaded || !parsedRobot) return;
      const loadedRobot = parsedRobot;
      parsedRobot = null;
      if (cancelled || loadFailed) {
        disposeObjectGraphs([loadedRobot]);
        return;
      }
      try {
        ownedModels = createLoadedModels(loadedRobot, props.profile);
        readyFrameCount.current = 0;
        setModels(ownedModels);
      } catch {
        loadFailed = true;
        disposeObjectGraphs([loadedRobot]);
        props.onModelState('error');
      }
    };

    manager.onError = () => {
      loadFailed = true;
      if (!cancelled) props.onModelState('error');
    };
    manager.onLoad = () => {
      resourcesLoaded = true;
      finalizeLoadedModels();
    };

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
        parsedRobot = loadedRobot;
        finalizeLoadedModels();
      },
      undefined,
      () => {
        loadFailed = true;
        if (!cancelled) props.onModelState('error');
      }
    );

    return () => {
      cancelled = true;
      if (ownedModels) {
        disposeObjectGraphs([ownedModels.actual, ownedModels.target]);
        ownedModels = null;
      } else if (resourcesLoaded && parsedRobot) {
        disposeObjectGraphs([parsedRobot]);
        parsedRobot = null;
      }
    };
  }, [props.profile, props.urdfUrl]);

  useEffect(() => {
    if (!models) return;
    const counts = inspectObjectGraphs([models.actual, models.target]);
    return acquireSceneResources({ modelRoots: 2, ...counts });
  }, [models]);

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

  useEffect(() => {
    if (!models) return;
    updateTargetHighlight(models.target, models.targetJoints, props.selectedJointId, props.profile);
  }, [models, props.profile, props.selectedJointId]);

  if (!models) return <LoadingSkeleton />;

  const handlePick = (event: ThreeEvent<PointerEvent>, rootJoints: Map<string, JointLike>) => {
    const urdfJointName = findOwningJointName(event.object, rootJoints);
    const profileJoint = props.profile.joints.find((joint) => joint.urdfJointName === urdfJointName);
    if (profileJoint) props.onSelectedJointChange(profileJoint.jointId);
  };
  const selectedJoint = props.profile.joints.find((joint) => joint.jointId === props.selectedJointId);
  const selectedTargetJoint = selectedJoint ? models.targetJoints.get(selectedJoint.urdfJointName) : undefined;
  const selectedTargetDeg = selectedJoint ? props.targetPositionsDeg[selectedJoint.protocolIndex] ?? 0 : 0;

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <primitive object={models.actual} onPointerDown={(event: ThreeEvent<PointerEvent>) => handlePick(event, models.actualJoints)} />
      <primitive object={models.target} onPointerDown={(event: ThreeEvent<PointerEvent>) => handlePick(event, models.targetJoints)} />
      {selectedJoint && selectedTargetJoint && createPortal(
        <JointManipulator
          joint={selectedTargetJoint}
          targetDeg={selectedTargetDeg}
          protocolIndex={selectedJoint.protocolIndex}
          onTargetChange={props.onJointTargetChange}
          onDraggingChange={props.onDraggingChange}
        />,
        selectedTargetJoint,
        { events: { priority: 2 } }
      )}
    </group>
  );
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

function SceneFallback({ reason }: { reason: string }) {
  return (
    <div className="sceneFallback" role="alert" data-testid="scene-fallback">
      <strong>3D VIEW UNAVAILABLE</strong>
      <span>{reason}</span>
      <small>关节目标仍可通过右侧数值控件进行本地预览；不会下发硬件。</small>
    </div>
  );
}

class SceneErrorBoundary extends Component<{
  children: ReactNode;
  onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  render() {
    return this.state.failed ? <SceneFallback reason="3D RENDER FAILURE" /> : this.props.children;
  }
}
