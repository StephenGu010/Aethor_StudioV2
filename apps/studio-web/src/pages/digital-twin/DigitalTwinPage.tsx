import {
  Axis3D,
  Box,
  Boxes,
  Crosshair,
  Focus,
  GitBranch,
  Grid3X3,
  Lightbulb,
  RotateCcw,
  ScanLine,
  Settings2,
  SunMedium
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from 'react';
import { FloatingToolWindow } from '../../components/workbench/FloatingToolWindow';
import type { SceneCapabilityState } from '../../components/visualization/sceneCapabilities';
import {
  getSceneResourceSnapshot,
  subscribeSceneResources
} from '../../components/visualization/sceneResourceTracker';
import { Hint } from '../../components/ui/Hint';
import { SourceTag } from '../../components/ui/SourceTag';
import { getJointKeyboardNudgeDeg } from '../../domain/jointInteraction';
import { showcaseEvents, showcaseJointFrame, showcaseSignalSeries } from '../../fixtures/showcase';
import { dummyProfile, dummyUrdfUrl } from '../../profile/dummyProfile';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { type ToolWindowId, useWorkbenchStore } from '../../stores/useWorkbenchStore';

const RobotScene = lazy(() => import('../../components/visualization/RobotScene')
  .then((module) => ({ default: module.RobotScene })));

export function DigitalTwinPage() {
  const actual = showcaseJointFrame.positionsDeg;
  const target = useRobotSessionStore((state) => state.targetPositionsDeg);
  const setJointTarget = useRobotSessionStore((state) => state.setJointTarget);
  const alignTarget = useRobotSessionStore((state) => state.alignTarget);
  const loadShowcasePose = useRobotSessionStore((state) => state.loadShowcasePose);
  const workbench = useWorkbenchStore();
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedJointId, setSelectedJointId] = useState<string>(dummyProfile.joints[0]!.jointId);
  const [sceneCapability, setSceneCapability] = useState<SceneCapabilityState>({ supported: true, quality: 'balanced' });
  const errors = useMemo(() => actual.map((value, index) => (target[index] ?? value) - value), [actual, target]);
  const selectedJoint = dummyProfile.joints.find((joint) => joint.jointId === selectedJointId);
  const selectedTargetDeg = selectedJoint ? target[selectedJoint.protocolIndex] ?? 0 : 0;
  const sceneSettings = {
    showVisual: workbench.showVisual,
    showCollision: workbench.showCollision,
    showGrid: workbench.showGrid,
    showShadows: workbench.showShadows,
    showLighting: workbench.showLighting,
    showBaseFrame: workbench.showBaseFrame,
    showTcpFrame: workbench.showTcpFrame,
    showJointAxes: workbench.showJointAxes
  };

  return (
    <div className="twinPage">
      <section className="scenePanel">
        <div className="sceneStage">
          <div className="sceneToolbar" aria-label="三维场景工具">
            <SceneButton label="模型树" active={workbench.windows.modelTree.open} onClick={() => workbench.toggleWindow('modelTree')}>
              <GitBranch size={16} />
            </SceneButton>
            <SceneButton label="显示设置" active={workbench.windows.display.open} onClick={() => workbench.toggleWindow('display')}>
              <Settings2 size={16} />
            </SceneButton>
            <SceneButton label="诊断" active={workbench.windows.diagnostics.open} onClick={() => workbench.toggleWindow('diagnostics')}>
              <ScanLine size={16} />
            </SceneButton>
            <span className="toolbarDivider" />
            <SceneButton label="重置相机" onClick={() => setCameraResetSignal((value) => value + 1)}>
              <Focus size={16} />
            </SceneButton>
            <SceneButton label="重置工具窗布局" onClick={workbench.resetLayout}>
              <RotateCcw size={16} />
            </SceneButton>
          </div>
          <Suspense fallback={<div className="sceneModuleLoading">LOADING 3D MODULE</div>}>
            <RobotScene
              profile={dummyProfile}
              urdfUrl={dummyUrdfUrl}
              actualPositionsDeg={actual}
              targetPositionsDeg={target}
              selectedJointId={selectedJointId}
              cameraResetSignal={cameraResetSignal}
              settings={sceneSettings}
              onSelectedJointChange={setSelectedJointId}
              onJointTargetChange={setJointTarget}
              onModelState={setModelState}
              onCapabilityState={setSceneCapability}
            />
          </Suspense>
          <div className="feedbackHud">
            <div><small>ACTUAL FEEDBACK</small><strong>SHOWCASE CAPTURE</strong></div>
            <div><span>J1</span><strong>{actual[0]?.toFixed(2)}°</strong></div>
            <div><span>J2</span><strong>{actual[1]?.toFixed(2)}°</strong></div>
            <div><span>FRAME</span><strong>BASE / Z-UP</strong></div>
          </div>
          <div className="sceneLegend">
            <div><span className="legendLine solid" /> SOLID · ACTUAL</div>
            <div><span className="legendLine ghost" /> GHOST · TARGET</div>
            <div><SourceTag source="showcase" /></div>
          </div>
          {selectedJoint && (
            <div
              className="jointManipulatorHud"
              tabIndex={0}
              aria-label={`${selectedJoint.displayName} 关节微调`}
              onKeyDown={(event) => {
                const delta = getJointKeyboardNudgeDeg(event.key, event.shiftKey);
                if (delta === undefined) return;
                event.preventDefault();
                setJointTarget(selectedJoint.protocolIndex, selectedTargetDeg + delta);
              }}
            >
              <span>SELECTED · {selectedJoint.displayName}</span>
              <strong>{selectedTargetDeg.toFixed(2)}°</strong>
              <small>拖动黄色旋转环 · 方向键 ±0.1° · Shift ±1°</small>
            </div>
          )}
          {modelState === 'error' && sceneCapability.supported && (
            <div className="sceneModelError" role="alert">
              <strong>MODEL RESOURCE FAILED</strong>
              <span>URDF、mesh 或关节映射加载失败；目标控件仍保持本地只读预览边界。</span>
            </div>
          )}
          <div className={`modelLoadState state-${modelState}`}>
            <span className={`statusDot ${modelState === 'ready' ? 'ok' : modelState === 'error' ? 'error' : 'warning'}`} />
            {!sceneCapability.supported
              ? 'WEBGL UNAVAILABLE'
              : modelState === 'ready'
                ? 'URDF READY'
                : modelState === 'error'
                  ? 'URDF LOAD FAILED'
                  : 'LOADING MODEL'}
          </div>
          <FloatingToolWindow id="modelTree" title="模型结构">
            <ModelTree selectedJointId={selectedJointId} onSelectedJointChange={setSelectedJointId} />
          </FloatingToolWindow>
          <FloatingToolWindow id="display" title="显示设置">
            <DisplaySettings />
          </FloatingToolWindow>
          <FloatingToolWindow id="diagnostics" title="模型诊断">
            <ModelDiagnostics modelState={modelState} capability={sceneCapability} />
          </FloatingToolWindow>
        </div>
      </section>

      <aside className="jointControlPanel">
        <div className="panelTitle">
          <div><h2>关节控制</h2><span>JOINT TARGET PREVIEW</span></div>
          <SourceTag source="commanded" />
        </div>
        <div className="controlModeTabs">
          <button type="button" className="active">关节</button>
          <Hint content="首版不包含末端位姿与 IK">
            <button type="button" disabled>末端位姿</button>
          </Hint>
        </div>
        <div className="jointRows">
          {dummyProfile.joints.map((joint) => {
            const current = actual[joint.protocolIndex] ?? 0;
            const targetValue = target[joint.protocolIndex] ?? current;
            return (
              <div className={joint.jointId === selectedJointId ? 'jointRow selected' : 'jointRow'} key={joint.jointId}>
                <div className="jointRowHeader">
                  <button
                    type="button"
                    className="jointSelectButton"
                    aria-label={`选择 ${joint.displayName} 关节`}
                    aria-pressed={joint.jointId === selectedJointId}
                    onClick={() => setSelectedJointId(joint.jointId)}
                    onKeyDown={(event) => {
                      const delta = getJointKeyboardNudgeDeg(event.key, event.shiftKey);
                      if (delta === undefined) return;
                      event.preventDefault();
                      setSelectedJointId(joint.jointId);
                      setJointTarget(joint.protocolIndex, targetValue + delta);
                    }}
                  >{joint.displayName}</button>
                  <span>{joint.lowerDeg.toFixed(0)}</span>
                  <span className="jointLimitSpacer" />
                  <span>{joint.upperDeg.toFixed(0)}</span>
                  <output>{current.toFixed(2)}°</output>
                </div>
                <div className="jointInputRow">
                  <input
                    aria-label={`${joint.displayName} 目标角度`}
                    type="range"
                    min={joint.lowerDeg}
                    max={joint.upperDeg}
                    step={0.1}
                    value={targetValue}
                    onFocus={() => setSelectedJointId(joint.jointId)}
                    onChange={(event) => setJointTarget(joint.protocolIndex, Number(event.currentTarget.value))}
                  />
                  <label>
                    <input
                      aria-label={`${joint.displayName} 目标角度数值`}
                      type="number"
                      min={joint.lowerDeg}
                      max={joint.upperDeg}
                      step={0.1}
                      value={Number(targetValue.toFixed(2))}
                      onFocus={() => setSelectedJointId(joint.jointId)}
                      onChange={(event) => setJointTarget(joint.protocolIndex, Number(event.currentTarget.value))}
                    />
                    <span>deg</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="previewNotice">
          <Crosshair size={15} />
          <span><strong>PREVIEW MODE</strong> · 拖拽与滑块只移动目标幽灵模型，不会下发硬件。</span>
        </div>
        <div className="jointSecondaryActions">
          <Hint content="需要 C# 设备服务">
            <button type="button" disabled>读取当前</button>
          </Hint>
          <button type="button" onClick={() => alignTarget(actual)}>目标对齐当前</button>
          <button type="button" onClick={loadShowcasePose}>加载展示位</button>
        </div>
        <Hint content="SERIAL OFFLINE · 后端未连接">
          <button className="sendGroupButton" type="button" disabled>下发整组关节角</button>
        </Hint>
      </aside>

      <section className="twinBottom">
        <MiniTrend />
        <div className="jointTableWrap">
          <table className="dataTable">
            <thead><tr><th>JOINT</th><th>ACTUAL (deg)</th><th>TARGET (deg)</th><th>ERROR (deg)</th><th>STATE</th></tr></thead>
            <tbody>
              {dummyProfile.joints.map((joint) => {
                const index = joint.protocolIndex;
                const error = errors[index] ?? 0;
                return (
                  <tr key={joint.jointId} data-joint-id={joint.jointId}>
                    <th>{joint.displayName}</th>
                    <td data-column="actual">{actual[index]?.toFixed(2)}</td>
                    <td data-column="target">{target[index]?.toFixed(2)}</td>
                    <td>{error.toFixed(2)}</td>
                    <td><span className="tableState showcase">SHOWCASE</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="recentEvents">
          <div className="bottomTitle"><strong>最近事件</strong><span>SHOWCASE CAPTURE</span></div>
          {showcaseEvents.slice(0, 4).map((event) => (
            <div className="eventRow" key={event.id}>
              <time>{formatTime(event.timestampUtc)}</time>
              <span className={`eventMark ${event.severity}`} />
              <div><strong>{event.title}</strong><small>{event.detail}</small></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SceneButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint content={label}>
      <button className={active ? 'active' : undefined} type="button" onClick={onClick} aria-label={label}>
        {children}
      </button>
    </Hint>
  );
}

function ModelTree({
  selectedJointId,
  onSelectedJointChange
}: {
  selectedJointId: string;
  onSelectedJointChange: (jointId: string) => void;
}) {
  return (
    <div className="modelTree">
      <TreeNode icon={<Boxes size={14} />} label="dummy" meta="ROBOT">
        <TreeNode icon={<Box size={14} />} label="base_link" meta="BASE" />
        {dummyProfile.joints.map((joint, index) => (
          <TreeNode
            key={joint.jointId}
            icon={<GitBranch size={14} />}
            label={joint.urdfJointName}
            meta={`J${index + 1}`}
            selected={joint.jointId === selectedJointId}
            onSelect={() => onSelectedJointChange(joint.jointId)}
          />
        ))}
      </TreeNode>
    </div>
  );
}

function TreeNode({
  icon,
  label,
  meta,
  selected,
  onSelect,
  children
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  selected?: boolean;
  onSelect?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="treeBranch">
      {onSelect ? (
        <button type="button" className={selected ? 'treeNode selected' : 'treeNode'} onClick={onSelect} aria-pressed={selected}>
          {icon}<span>{label}</span><small>{meta}</small>
        </button>
      ) : (
        <div className="treeNode">{icon}<span>{label}</span><small>{meta}</small></div>
      )}
      {children && <div className="treeChildren">{children}</div>}
    </div>
  );
}

function DisplaySettings() {
  const store = useWorkbenchStore();
  const options = [
    ['showVisual', '视觉模型', <Box size={14} />],
    ['showCollision', '碰撞模型', <Boxes size={14} />],
    ['showGrid', '地面网格', <Grid3X3 size={14} />],
    ['showShadows', '实时阴影', <SunMedium size={14} />],
    ['showLighting', '场景光照', <Lightbulb size={14} />],
    ['showBaseFrame', '基座坐标系', <Axis3D size={14} />],
    ['showTcpFrame', 'TCP 坐标系', <Crosshair size={14} />],
    ['showJointAxes', '关节轴', <Axis3D size={14} />]
  ] as const;
  return (
    <div className="toggleList">
      {options.map(([key, label, icon]) => (
        <label key={key}>
          <span>{icon}{label}</span>
          <input type="checkbox" checked={store[key]} onChange={(event) => store.setDisplay(key, event.currentTarget.checked)} />
        </label>
      ))}
    </div>
  );
}

function ModelDiagnostics({
  modelState,
  capability
}: {
  modelState: 'loading' | 'ready' | 'error';
  capability: SceneCapabilityState;
}) {
  const resources = useSyncExternalStore(
    subscribeSceneResources,
    getSceneResourceSnapshot,
    getSceneResourceSnapshot
  );
  return (
    <dl className="diagnosticList" data-testid="scene-resource-diagnostics">
      <div><dt>PROFILE</dt><dd>dummy-6dof</dd></div>
      <div><dt>SCHEMA</dt><dd>1.0 · VALID</dd></div>
      <div><dt>URDF</dt><dd>{modelState.toUpperCase()}</dd></div>
      <div><dt>QUALITY</dt><dd>{capability.quality.toUpperCase()}</dd></div>
      <div><dt>DOF</dt><dd>6</dd></div>
      <div><dt>UP AXIS</dt><dd>Z</dd></div>
      <div><dt>RENDERER / CONTROLS</dt><dd>{resources.renderers} / {resources.controls}</dd></div>
      <div><dt>MODEL ROOTS</dt><dd>{resources.modelRoots}</dd></div>
      <div><dt>GEOMETRY / MATERIAL</dt><dd>{resources.geometries} / {resources.materials}</dd></div>
      <div><dt>DRAG SESSION</dt><dd>{resources.dragSessions}</dd></div>
      <div><dt>SOURCE</dt><dd>SHOWCASE</dd></div>
      <div><dt>EFFORT / VELOCITY</dt><dd>UNVERIFIED</dd></div>
    </dl>
  );
}

function MiniTrend() {
  const series = showcaseSignalSeries.find((item) => item.descriptor.signalId === 'j1.actual.position');
  const points = series?.samples.filter((_, index) => index % 12 === 0).map((sample) => sample.value ?? 0) ?? [];
  const minimum = Math.min(...points);
  const maximum = Math.max(...points);
  const range = Math.max(0.01, maximum - minimum);
  const path = points.map((value, index) => {
    const x = (index / Math.max(1, points.length - 1)) * 100;
    const y = 88 - ((value - minimum) / range) * 65;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div className="miniTrend">
      <div className="bottomTitle"><strong>关节角趋势</strong><span>30 s · J1 ACTUAL</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="J1 展示关节角趋势">
        <path className="trendGrid" d="M0 25H100M0 50H100M0 75H100" />
        <path className="trendLine" d={path} />
      </svg>
      <div className="trendFooter"><span>{minimum.toFixed(2)}°</span><span>SHOWCASE CAPTURE</span><span>{maximum.toFixed(2)}°</span></div>
    </div>
  );
}

function formatTime(timestampUtc: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestampUtc));
}
