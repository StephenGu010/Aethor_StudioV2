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
import { calculatePerspectiveCameraFit, type SceneBounds } from './cameraFit';
import { JointManipulator } from './JointManipulator';
import {
  calculateReferenceGridLayout,
  type ReferenceGridLayout
} from './referenceGrid';
import {
  applyJointPositions,
  applyActualJointAvailability,
  applyVisibility,
  calculateLoadedModelBounds,
  createLoadedModels,
  findOwningJointName,
  type JointLike,
  type LoadedModels,
  updateTargetHighlight
} from './robotModel';
import { detectSceneCapabilities, type SceneCapabilityState } from './sceneCapabilities';
import { calculateSceneDevicePixelRatio } from './sceneRenderPolicy';
import { disposeObjectGraphs, inspectObjectGraphs } from './sceneResources';
import { acquireSceneResources } from './sceneResourceTracker';
import { SharedGeometryLoadCache } from './sharedGeometryLoadCache';
import { shouldRetrySameOriginStaticAsset } from './staticAssetLoadPolicy';

interface RobotSceneProps {
  profile: RobotProfileManifestV1;
  urdfUrl: string;
  actualPositionsDeg: number[];
  targetPositionsDeg: number[];
  selectedJointId: string;
  cameraResetSignal: number;
  cameraFocusGroupId?: string | null;
  degradedActualJointIds?: readonly string[];
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
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const cameraBoundsRef = useRef<SceneBounds | null>(null);
  const cameraBoundsRevisionRef = useRef(0);
  const cameraResetSignalRef = useRef(props.cameraResetSignal);
  const [cameraFitSignal, setCameraFitSignal] = useState(0);
  const [referenceGrid, setReferenceGrid] = useState<ReferenceGridLayout | null>(null);
  cameraResetSignalRef.current = props.cameraResetSignal;

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
  const handleCameraBounds = useCallback((bounds: SceneBounds | null, fitImmediately: boolean) => {
    cameraBoundsRef.current = bounds;
    if (!bounds && sceneHostRef.current) {
      sceneHostRef.current.dataset.cameraFit = 'pending';
      delete sceneHostRef.current.dataset.cameraFitDistance;
    }
    if (bounds && sceneHostRef.current) {
      cameraBoundsRevisionRef.current += 1;
      sceneHostRef.current.dataset.cameraBoundsRevision = String(cameraBoundsRevisionRef.current);
    }
    if (fitImmediately && bounds) setCameraFitSignal((value) => value + 1);
  }, []);
  const handleReferenceGridBounds = useCallback((bounds: SceneBounds | null) => {
    const layout = bounds ? calculateReferenceGridLayout(bounds) : null;
    setReferenceGrid((current) => sameReferenceGrid(current, layout) ? current : layout);
    const host = sceneHostRef.current;
    if (!host || !layout) {
      if (host) {
        host.dataset.referenceGrid = 'pending';
        delete host.dataset.referenceGridSize;
        delete host.dataset.referenceGridY;
        delete host.dataset.modelMinY;
        delete host.dataset.modelFootprint;
      }
      return;
    }
    host.dataset.referenceGrid = 'ready';
    host.dataset.referenceGridSize = layout.size.toFixed(4);
    host.dataset.referenceGridY = layout.position[1].toFixed(6);
    host.dataset.modelMinY = layout.modelMinY.toFixed(6);
    host.dataset.modelFootprint = layout.footprintSize.toFixed(4);
  }, []);

  if (!capability.supported || runtimeFailure) {
    return <SceneFallback reason={runtimeFailure ? 'WEBGL CONTEXT LOST' : 'WEBGL UNAVAILABLE'} />;
  }

  const constrained = capability.quality === 'constrained';
  const shadowsEnabled = props.settings.showShadows && !constrained;

  return (
    <div
      ref={sceneHostRef}
      className="robotSceneHost"
      data-scene-quality={capability.quality}
      data-camera-fit="pending"
      data-camera-bounds-revision="0"
      data-camera-focus={props.cameraFocusGroupId ?? 'all'}
      data-render-policy="demand"
      data-render-dpr="1.000"
      data-render-frame-count="0"
      data-reference-grid="pending"
    >
      <SceneErrorBoundary onError={handleRuntimeFailure}>
        <Canvas
          frameloop="demand"
          shadows={shadowsEnabled ? 'percentage' : false}
          camera={{ position: [0.78, 0.58, 0.84], fov: 39, near: 0.01, far: 40 }}
          dpr={1}
          gl={{ antialias: !constrained, powerPreference: constrained ? 'default' : 'high-performance' }}
        >
          <RendererLifecycle onContextLost={handleRuntimeFailure} />
          <AdaptiveSceneDpr quality={capability.quality} />
          <color attach="background" args={['#080a0c']} />
          <SceneLighting enabled={props.settings.showLighting} shadows={shadowsEnabled} />
          <CameraController
            resetSignalRef={cameraResetSignalRef}
            fitSignal={cameraFitSignal}
            boundsRef={cameraBoundsRef}
            sceneHostRef={sceneHostRef}
            draggingRef={draggingRef}
          />
          {props.settings.showGrid && referenceGrid && <GridFloor layout={referenceGrid} />}
          {props.settings.showBaseFrame && <Axes scale={0.12} position={[-0.38, -0.001, 0.3]} />}
          <RobotModels
            {...props}
            onDraggingChange={handleDraggingChange}
            onCameraBounds={handleCameraBounds}
            onReferenceGridBounds={handleReferenceGridBounds}
          />
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

function AdaptiveSceneDpr({ quality }: { quality: SceneCapabilityState['quality'] }) {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const setDpr = useThree((state) => state.setDpr);
  const invalidate = useThree((state) => state.invalidate);
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => window.devicePixelRatio);

  useEffect(() => {
    const handleWindowMetricsChange = () => {
      setDevicePixelRatio((current) => current === window.devicePixelRatio
        ? current
        : window.devicePixelRatio);
    };
    window.addEventListener('resize', handleWindowMetricsChange, { passive: true });
    return () => window.removeEventListener('resize', handleWindowMetricsChange);
  }, []);

  useEffect(() => {
    const dpr = calculateSceneDevicePixelRatio({
      width: size.width,
      height: size.height,
      devicePixelRatio,
      quality
    });
    const host = gl.domElement.closest<HTMLElement>('.robotSceneHost');
    if (host) host.dataset.renderDpr = dpr.toFixed(3);
    if (Math.abs(gl.getPixelRatio() - dpr) < 0.001) return;
    setDpr(dpr);
    invalidate();
  }, [devicePixelRatio, gl, invalidate, quality, setDpr, size.height, size.width]);

  return null;
}

function RendererLifecycle({ onContextLost }: { onContextLost: () => void }) {
  const gl = useThree((state) => state.gl);
  const frameCount = useRef(0);
  useFrame(() => {
    frameCount.current += 1;
    const host = gl.domElement.closest<HTMLElement>('.robotSceneHost');
    if (host) host.dataset.renderFrameCount = String(frameCount.current);
  });
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
      const host = canvas.closest<HTMLElement>('.robotSceneHost');
      if (host) delete host.dataset.renderFrameCount;
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
  resetSignalRef,
  fitSignal,
  boundsRef,
  sceneHostRef,
  draggingRef
}: {
  resetSignalRef: MutableRefObject<number>;
  fitSignal: number;
  boundsRef: MutableRefObject<SceneBounds | null>;
  sceneHostRef: MutableRefObject<HTMLDivElement | null>;
  draggingRef: MutableRefObject<boolean>;
}) {
  const { camera, gl, invalidate, size } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    const release = acquireSceneResources({ controls: 1 });
    const handleChange = () => invalidate();
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.target.set(0, 0.18, 0);
    controls.minDistance = 0.35;
    controls.maxDistance = 4.5;
    controls.maxPolarAngle = Math.PI * 0.89;
    controls.addEventListener('change', handleChange);
    controls.update();
    invalidate();
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener('change', handleChange);
      controls.dispose();
      controlsRef.current = null;
      release();
    };
  }, [camera, gl.domElement, invalidate]);

  useEffect(() => {
    const controls = controlsRef.current;
    const bounds = boundsRef.current;
    const fit = camera instanceof THREE.PerspectiveCamera && bounds
      ? calculatePerspectiveCameraFit(bounds, camera.fov, Math.max(size.width / Math.max(size.height, 1), 0.01))
      : null;
    if (fit) {
      camera.position.set(...fit.position);
      camera.near = fit.near;
      camera.far = fit.far;
      camera.updateProjectionMatrix();
      if (controls) {
        controls.target.set(...fit.target);
        controls.minDistance = fit.minDistance;
        controls.maxDistance = fit.maxDistance;
      }
      if (sceneHostRef.current) {
        sceneHostRef.current.dataset.cameraFit = 'ready';
        sceneHostRef.current.dataset.cameraFitDistance = fit.distance.toFixed(6);
        sceneHostRef.current.dataset.cameraResetSignal = String(resetSignalRef.current);
      }
    } else {
      camera.position.set(0.78, 0.58, 0.84);
      controls?.target.set(0, 0.18, 0);
      if (sceneHostRef.current) {
        sceneHostRef.current.dataset.cameraFit = 'pending';
        delete sceneHostRef.current.dataset.cameraFitDistance;
        sceneHostRef.current.dataset.cameraResetSignal = String(resetSignalRef.current);
      }
    }
    controls?.update();
    invalidate();
  }, [camera, fitSignal, invalidate, resetSignalRef, sceneHostRef, size.height, size.width]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.enabled = !draggingRef.current;
    if (controls.update()) invalidate();
  });
  return null;
}

function GridFloor({ layout }: { layout: ReferenceGridLayout }) {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(layout.size, layout.divisions, '#30363d', '#171b20');
    const material = helper.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.62;
    return helper;
  }, [layout.divisions, layout.size]);
  useEffect(() => () => {
    grid.geometry.dispose();
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material) => material.dispose());
  }, [grid]);
  return <primitive object={grid} position={layout.position} />;
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

function RobotModels(props: RobotSceneProps & {
  onDraggingChange: (dragging: boolean) => void;
  onCameraBounds: (bounds: SceneBounds | null, fitImmediately: boolean) => void;
  onReferenceGridBounds: (bounds: SceneBounds | null) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const [models, setModels] = useState<LoadedModels | null>(null);
  const readyFrameCount = useRef(0);
  const initialCameraFitApplied = useRef(false);
  const previousCameraFocusKey = useRef('all');
  const previousCameraResetSignal = useRef(props.cameraResetSignal);
  const previousActualPositions = useRef<readonly number[] | null>(null);
  const previousTargetPositions = useRef<readonly number[] | null>(null);
  const degradedActualJointKey = [...(props.degradedActualJointIds ?? [])].sort().join('|');

  useFrame(() => {
    if (!models || readyFrameCount.current >= 2) return;
    readyFrameCount.current += 1;
    if (readyFrameCount.current === 2) {
      props.onModelState('ready');
      return;
    }
    invalidate();
  });

  useEffect(() => {
    let cancelled = false;
    let loadFailed = false;
    let resourcesLoaded = false;
    let parsedRobot: THREE.Object3D | null = null;
    let ownedModels: LoadedModels | null = null;
    initialCameraFitApplied.current = false;
    previousCameraFocusKey.current = 'all';
    previousCameraResetSignal.current = props.cameraResetSignal;
    previousActualPositions.current = null;
    previousTargetPositions.current = null;
    props.onCameraBounds(null, false);
    props.onReferenceGridBounds(null);
    setModels(null);
    props.onModelState('loading');
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);
    let actualMaterial: THREE.MeshStandardMaterial | null = null;
    const geometryCache = new SharedGeometryLoadCache((path, onLoad, onError) => {
      const loadStl = (attempt: number) => {
        new STLLoader(manager).load(
          path,
          (geometry) => {
            geometry.computeVertexNormals();
            onLoad(geometry);
          },
          undefined,
          (error) => {
            if (!cancelled && shouldRetrySameOriginStaticAsset({
              assetUrl: path,
              documentUrl: globalThis.location.href,
              attempt,
              error
            })) {
              loadStl(attempt + 1);
              return;
            }
            onError(error);
          }
        );
      };
      loadStl(0);
    });

    const getActualMaterial = () => {
      actualMaterial ??= new THREE.MeshStandardMaterial({
        color: '#b8bdc2',
        metalness: 0.48,
        roughness: 0.34
      });
      return actualMaterial;
    };

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
        invalidate();
      } catch {
        loadFailed = true;
        disposeObjectGraphs([loadedRobot]);
        props.onModelState('error');
      }
    };

    const failModelLoad = () => {
      loadFailed = true;
      if (!cancelled) props.onModelState('error');
    };
    manager.onLoad = () => {
      resourcesLoaded = true;
      finalizeLoadedModels();
    };

    loader.parseCollision = true;
    loader.loadMeshCb = (path, _loadManager, _urdfMaterial, done) => {
      geometryCache.request(path, {
        onLoad: (geometry) => done(new THREE.Mesh(geometry, getActualMaterial())),
        onError: (error) => {
          failModelLoad();
          done(new THREE.Object3D(), error instanceof Error ? error : new Error('Static mesh load failed'));
        }
      });
    };
    const loadUrdf = (attempt: number) => {
      loader.load(
        props.urdfUrl,
        (loadedRobot) => {
          parsedRobot = loadedRobot;
          finalizeLoadedModels();
        },
        undefined,
        (error) => {
          if (!cancelled && shouldRetrySameOriginStaticAsset({
            assetUrl: props.urdfUrl,
            documentUrl: globalThis.location.href,
            attempt,
            error
          })) {
            loadUrdf(attempt + 1);
            return;
          }
          failModelLoad();
        }
      );
    };
    loadUrdf(0);

    return () => {
      cancelled = true;
      props.onCameraBounds(null, false);
      props.onReferenceGridBounds(null);
      if (ownedModels) {
        disposeObjectGraphs([ownedModels.actual, ownedModels.target]);
        ownedModels = null;
      } else if (resourcesLoaded && parsedRobot) {
        disposeObjectGraphs([parsedRobot]);
        parsedRobot = null;
      }
    };
  }, [invalidate, props.onCameraBounds, props.onReferenceGridBounds, props.profile, props.urdfUrl]);

  useEffect(() => {
    if (!models) return;
    const counts = inspectObjectGraphs([models.actual, models.target]);
    return acquireSceneResources({ modelRoots: 2, ...counts });
  }, [models]);

  useEffect(() => {
    if (!models || !degradedActualJointKey) {
      if (models) applyActualJointAvailability(models, props.profile, new Set());
      return;
    }
    const degradedMaterial = new THREE.MeshStandardMaterial({
      color: '#4b5258',
      metalness: 0.12,
      roughness: 0.82
    });
    const release = acquireSceneResources({ materials: 1 });
    applyActualJointAvailability(
      models,
      props.profile,
      new Set(degradedActualJointKey.split('|')),
      degradedMaterial
    );
    invalidate();
    return () => {
      applyActualJointAvailability(models, props.profile, new Set());
      degradedMaterial.dispose();
      release();
    };
  }, [degradedActualJointKey, invalidate, models, props.profile]);

  useEffect(() => {
    if (!models) return;
    applyJointPositions(
      models.actualJoints,
      props.profile,
      props.actualPositionsDeg,
      previousActualPositions.current ?? undefined
    );
    previousActualPositions.current = [...props.actualPositionsDeg];
    invalidate();
  }, [invalidate, models, props.actualPositionsDeg, props.profile]);

  useEffect(() => {
    if (!models) return;
    applyJointPositions(
      models.targetJoints,
      props.profile,
      props.targetPositionsDeg,
      previousTargetPositions.current ?? undefined
    );
    previousTargetPositions.current = [...props.targetPositionsDeg];
    invalidate();
  }, [invalidate, models, props.profile, props.targetPositionsDeg]);

  useEffect(() => {
    if (!models) return;
    const fullBounds = calculateLoadedModelBounds(models, props.profile, null);
    props.onReferenceGridBounds(fullBounds);
    const nextBounds = props.cameraFocusGroupId
      ? calculateLoadedModelBounds(models, props.profile, props.cameraFocusGroupId)
      : fullBounds;
    if (!nextBounds) return;
    const focusKey = props.cameraFocusGroupId ?? 'all';
    const resetRequested = previousCameraResetSignal.current !== props.cameraResetSignal;
    const fitImmediately = !initialCameraFitApplied.current
      || previousCameraFocusKey.current !== focusKey
      || resetRequested;
    initialCameraFitApplied.current = true;
    previousCameraFocusKey.current = focusKey;
    previousCameraResetSignal.current = props.cameraResetSignal;
    props.onCameraBounds(nextBounds, fitImmediately);
  }, [
    models,
    props.cameraFocusGroupId,
    props.cameraResetSignal,
    props.onCameraBounds,
    props.onReferenceGridBounds,
    props.profile
  ]);

  useEffect(() => {
    if (!models) return;
    applyVisibility(models.actual, props.settings.showVisual, props.settings.showCollision);
    models.actualJoints.forEach((joint) => {
      const marker = joint.getObjectByName('aethor-joint-axis');
      if (marker) marker.visible = props.settings.showJointAxes;
    });
    models.actual.traverse((object) => {
      if (object.name.startsWith('aethor-tcp-axis:')) object.visible = props.settings.showTcpFrame;
    });
    invalidate();
  }, [
    invalidate,
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
    const groupedTcpLinks = props.profile.jointGroups
      ?.map((group) => group.tcpLinkName)
      .filter((linkName): linkName is string => Boolean(linkName)) ?? [];
    const tcpLinkNames = groupedTcpLinks.length > 0 ? groupedTcpLinks : ['link_6'];
    tcpLinkNames.forEach((linkName) => {
      const tcpLink = models.actual.getObjectByName(linkName);
      const markerName = `aethor-tcp-axis:${linkName}`;
      if (!tcpLink || tcpLink.getObjectByName(markerName)) return;
      const tcpAxes = new THREE.AxesHelper(0.085);
      tcpAxes.name = markerName;
      tcpAxes.visible = props.settings.showTcpFrame;
      tcpLink.add(tcpAxes);
    });
    invalidate();
  }, [invalidate, models, props.profile, props.settings.showJointAxes, props.settings.showTcpFrame]);

  useEffect(() => {
    if (!models) return;
    updateTargetHighlight(models.target, models.targetJoints, props.selectedJointId, props.profile);
    invalidate();
  }, [invalidate, models, props.profile, props.selectedJointId]);

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

function sameReferenceGrid(current: ReferenceGridLayout | null, next: ReferenceGridLayout | null) {
  if (current === next) return true;
  if (!current || !next) return false;
  return current.size === next.size
    && current.divisions === next.divisions
    && current.modelMinY === next.modelMinY
    && current.footprintSize === next.footprintSize
    && current.clearance === next.clearance
    && current.position.every((value, index) => value === next.position[index]);
}
