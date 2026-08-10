import type { RobotJointGroupV1, RobotJointProfile } from '@aethor/contracts';
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
import { lazy, Suspense, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Hint } from '../../components/ui/Hint';
import { SourceTag } from '../../components/ui/SourceTag';
import type { SceneCapabilityState } from '../../components/visualization/sceneCapabilities';
import {
  getSceneResourceSnapshot,
  subscribeSceneResources
} from '../../components/visualization/sceneResourceTracker';
import { FloatingToolWindow } from '../../components/workbench/FloatingToolWindow';
import { getJointKeyboardNudgeDeg } from '../../domain/jointInteraction';
import {
  aethorRoboJointGroups,
  aethorRoboProfile,
  aethorRoboUrdfUrl
} from '../../profile/aethorRoboProfile';
import { useAethorRoboConsoleStore } from '../../stores/useAethorRoboConsoleStore';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import { type ToolWindowId, useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { DummyConsole } from './DummyConsole';

const RobotScene = lazy(() => import('../../components/visualization/RobotScene')
  .then((module) => ({ default: module.RobotScene })));

const modelPoseDeg = [...(aethorRoboProfile.model.showcasePoseDeg
  ?? Array(aethorRoboProfile.model.dof).fill(0))];

const consoleEvents = [
  { id: 'model', severity: 'info', title: 'Dual-arm model normalized', detail: '14 arm joints / 6 model-only wheel joints' },
  { id: 'left', severity: 'info', title: 'Left arm mapping ready', detail: 'L-J1…L-J7 · local preview only' },
  { id: 'right', severity: 'info', title: 'Right arm mapping ready', detail: 'R-J1…R-J7 · local preview only' },
  { id: 'protocol', severity: 'warning', title: 'Hardware contract pending', detail: 'No serial, feedback, enable or command path' }
] as const;

export function ConsolePage() {
  const activeProfileId = useActiveRobotProfileStore((state) => state.activeProfileId);
  return activeProfileId === aethorRoboProfile.profileId ? <AethorRoboConsole /> : <DummyConsole />;
}

function AethorRoboConsole() {
  const modelTreeOpen = useWorkbenchStore((state) => state.windows.modelTree.open);
  const displayOpen = useWorkbenchStore((state) => state.windows.display.open);
  const diagnosticsOpen = useWorkbenchStore((state) => state.windows.diagnostics.open);
  const toggleWindow = useWorkbenchStore((state) => state.toggleWindow);
  const resetLayout = useWorkbenchStore((state) => state.resetLayout);
  const initialGroup = aethorRoboJointGroups[0];
  const [activeGroupId, setActiveGroupId] = useState(initialGroup?.groupId ?? 'left-arm');
  const [cameraFocusGroupId, setCameraFocusGroupId] = useState<string | null>(null);
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedJointId, setSelectedJointId] = useState(aethorRoboProfile.joints[0]!.jointId);
  const [sceneCapability, setSceneCapability] = useState<SceneCapabilityState>({ supported: true, quality: 'balanced' });
  const activeGroup = aethorRoboJointGroups.find((group) => group.groupId === activeGroupId);
  const activeGroupJointIds = new Set(activeGroup?.jointIds ?? []);
  const activeJoints = activeGroup
    ? aethorRoboProfile.joints.filter((joint) => activeGroupJointIds.has(joint.jointId))
    : aethorRoboProfile.joints;
  const selectedJoint = aethorRoboProfile.joints.find((joint) => joint.jointId === selectedJointId);

  const selectJoint = useCallback((jointId: string) => {
    setSelectedJointId(jointId);
    const owner = aethorRoboJointGroups.find((group) => group.jointIds.includes(jointId));
    if (owner) setActiveGroupId(owner.groupId);
  }, []);

  const selectCameraFocus = useCallback((groupId: string | null) => {
    setCameraFocusGroupId(groupId);
    if (!groupId) return;
    const group = aethorRoboJointGroups.find((candidate) => candidate.groupId === groupId);
    if (!group) return;
    setActiveGroupId(group.groupId);
    const firstJointId = group.jointIds[0];
    if (firstJointId) setSelectedJointId(firstJointId);
  }, []);

  return (
    <div className="twinPage">
      <section className="scenePanel">
        <div className="sceneStage">
          <div className="sceneToolbar" aria-label="三维场景工具">
            <SceneButton label="模型树" active={modelTreeOpen} onClick={() => toggleWindow('modelTree')}>
              <GitBranch size={16} />
            </SceneButton>
            <SceneButton label="显示设置" active={displayOpen} onClick={() => toggleWindow('display')}>
              <Settings2 size={16} />
            </SceneButton>
            <SceneButton label="诊断" active={diagnosticsOpen} onClick={() => toggleWindow('diagnostics')}>
              <ScanLine size={16} />
            </SceneButton>
            <span className="toolbarDivider" />
            <SceneButton label="重置相机" onClick={() => setCameraResetSignal((value) => value + 1)}>
              <Focus size={16} />
            </SceneButton>
            <SceneButton label="重置工具窗布局" onClick={resetLayout}>
              <RotateCcw size={16} />
            </SceneButton>
          </div>
          <div className="sceneFocusTabs" role="group" aria-label="相机取景">
            <button type="button" aria-pressed={cameraFocusGroupId === null} onClick={() => selectCameraFocus(null)}>整机</button>
            {aethorRoboJointGroups.map((group) => (
              <button
                key={group.groupId}
                type="button"
                aria-pressed={cameraFocusGroupId === group.groupId}
                onClick={() => selectCameraFocus(group.groupId)}
              >{group.displayName}</button>
            ))}
          </div>
          <Suspense fallback={<div className="sceneModuleLoading">LOADING 3D MODULE</div>}>
            <RobotScenePreview
              selectedJointId={selectedJointId}
              cameraResetSignal={cameraResetSignal}
              cameraFocusGroupId={cameraFocusGroupId}
              onSelectedJointChange={selectJoint}
              onModelState={setModelState}
              onCapabilityState={setSceneCapability}
            />
          </Suspense>
          <div className="feedbackHud">
            <div><small>MODEL STATE</small><strong>LOCAL PREVIEW</strong></div>
            <div><span>LEFT</span><strong>7-DOF</strong></div>
            <div><span>RIGHT</span><strong>7-DOF</strong></div>
            <div><span>FRAME</span><strong>BASE / Z-UP</strong></div>
          </div>
          <div className="sceneLegend">
            <div><span className="legendLine solid" /> SOLID · MODEL POSE</div>
            <div><span className="legendLine ghost" /> GHOST · TARGET</div>
            <div><SourceTag source="showcase" /></div>
          </div>
          {selectedJoint && <JointManipulatorHud joint={selectedJoint} />}
          {modelState === 'error' && sceneCapability.supported && (
            <div className="sceneModelError" role="alert">
              <strong>MODEL RESOURCE FAILED</strong>
              <span>Aethor_robo URDF、mesh 或双臂关节映射加载失败；本地数值草稿仍可操作。</span>
            </div>
          )}
          <div className={`modelLoadState state-${modelState}`}>
            <span className={`statusDot ${modelState === 'ready' ? 'ok' : modelState === 'error' ? 'error' : 'warning'}`} />
            {!sceneCapability.supported
              ? 'WEBGL UNAVAILABLE'
              : modelState === 'ready'
                ? 'Aethor_robo · URDF READY'
                : modelState === 'error'
                  ? 'URDF LOAD FAILED'
                  : 'LOADING MODEL'}
          </div>
          <FloatingToolWindow id="modelTree" title="模型结构">
            <ModelTree selectedJointId={selectedJointId} onSelectedJointChange={selectJoint} />
          </FloatingToolWindow>
          <FloatingToolWindow id="display" title="显示设置">
            <DisplaySettings />
          </FloatingToolWindow>
          <FloatingToolWindow id="diagnostics" title="模型诊断">
            <ModelDiagnostics modelState={modelState} capability={sceneCapability} />
          </FloatingToolWindow>
        </div>
      </section>

      <JointControlPanel
        activeGroupId={activeGroupId}
        activeJoints={activeJoints}
        selectedJointId={selectedJointId}
        onActiveGroupChange={setActiveGroupId}
        onSelectedJointChange={selectJoint}
      />

      <ConsoleBottom activeJoints={activeJoints} />
    </div>
  );
}

function RobotScenePreview({
  selectedJointId,
  cameraResetSignal,
  cameraFocusGroupId,
  onSelectedJointChange,
  onModelState,
  onCapabilityState
}: {
  selectedJointId: string;
  cameraResetSignal: number;
  cameraFocusGroupId: string | null;
  onSelectedJointChange: (jointId: string) => void;
  onModelState: (state: 'loading' | 'ready' | 'error') => void;
  onCapabilityState: (state: SceneCapabilityState) => void;
}) {
  const target = useAethorRoboConsoleStore((state) => state.targetPositionsDeg);
  const setJointTarget = useAethorRoboConsoleStore((state) => state.setJointTarget);
  const settings = {
    showVisual: useWorkbenchStore((state) => state.showVisual),
    showCollision: useWorkbenchStore((state) => state.showCollision),
    showGrid: useWorkbenchStore((state) => state.showGrid),
    showShadows: useWorkbenchStore((state) => state.showShadows),
    showLighting: useWorkbenchStore((state) => state.showLighting),
    showBaseFrame: useWorkbenchStore((state) => state.showBaseFrame),
    showTcpFrame: useWorkbenchStore((state) => state.showTcpFrame),
    showJointAxes: useWorkbenchStore((state) => state.showJointAxes)
  };

  return (
    <RobotScene
      profile={aethorRoboProfile}
      urdfUrl={aethorRoboUrdfUrl}
      actualPositionsDeg={modelPoseDeg}
      targetPositionsDeg={target}
      selectedJointId={selectedJointId}
      cameraResetSignal={cameraResetSignal}
      cameraFocusGroupId={cameraFocusGroupId}
      settings={settings}
      onSelectedJointChange={onSelectedJointChange}
      onJointTargetChange={setJointTarget}
      onModelState={onModelState}
      onCapabilityState={onCapabilityState}
    />
  );
}

function JointManipulatorHud({ joint }: { joint: RobotJointProfile }) {
  const targetDeg = useAethorRoboConsoleStore(
    (state) => state.targetPositionsDeg[joint.protocolIndex] ?? 0
  );
  const setJointTarget = useAethorRoboConsoleStore((state) => state.setJointTarget);
  return (
    <div
      className="jointManipulatorHud"
      tabIndex={0}
      aria-label={`${joint.displayName} 关节微调`}
      onKeyDown={(event) => {
        const delta = getJointKeyboardNudgeDeg(event.key, event.shiftKey);
        if (delta === undefined) return;
        event.preventDefault();
        setJointTarget(joint.protocolIndex, targetDeg + delta);
      }}
    >
      <span>SELECTED · {joint.displayName}</span>
      <strong>{targetDeg.toFixed(2)}°</strong>
      <small>拖动黄色旋转环 · 方向键 ±0.1° · Shift ±1°</small>
    </div>
  );
}

function JointControlPanel({
  activeGroupId,
  activeJoints,
  selectedJointId,
  onActiveGroupChange,
  onSelectedJointChange
}: {
  activeGroupId: string;
  activeJoints: readonly RobotJointProfile[];
  selectedJointId: string;
  onActiveGroupChange: (groupId: string) => void;
  onSelectedJointChange: (jointId: string) => void;
}) {
  const target = useAethorRoboConsoleStore((state) => state.targetPositionsDeg);
  const setJointTarget = useAethorRoboConsoleStore((state) => state.setJointTarget);
  const alignTarget = useAethorRoboConsoleStore((state) => state.alignTarget);
  const resetPreview = useAethorRoboConsoleStore((state) => state.resetPreview);
  return (
    <aside className="jointControlPanel">
      <div className="panelTitle">
        <div><h2>双臂关节预览</h2><span>Aethor_robo · 2 × 7-DOF</span></div>
        <SourceTag source="commanded" />
      </div>
      <div className="controlModeTabs" aria-label="机械臂控制组">
        {aethorRoboJointGroups.map((group) => (
          <button
            key={group.groupId}
            type="button"
            className={group.groupId === activeGroupId ? 'active' : undefined}
            aria-pressed={group.groupId === activeGroupId}
            onClick={() => {
              onActiveGroupChange(group.groupId);
              const firstJointId = group.jointIds[0];
              if (firstJointId) onSelectedJointChange(firstJointId);
            }}
          >{group.displayName} · 7轴</button>
        ))}
      </div>
      <div className="jointRows">
        {activeJoints.map((joint) => {
          const current = modelPoseDeg[joint.protocolIndex] ?? 0;
          const targetValue = target[joint.protocolIndex] ?? current;
          return (
            <div className={joint.jointId === selectedJointId ? 'jointRow selected' : 'jointRow'} key={joint.jointId}>
              <div className="jointRowHeader">
                <button
                  type="button"
                  className="jointSelectButton"
                  aria-label={`选择 ${joint.displayName} 关节`}
                  aria-pressed={joint.jointId === selectedJointId}
                  onClick={() => onSelectedJointChange(joint.jointId)}
                  onKeyDown={(event) => {
                    const delta = getJointKeyboardNudgeDeg(event.key, event.shiftKey);
                    if (delta === undefined) return;
                    event.preventDefault();
                    onSelectedJointChange(joint.jointId);
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
                  onFocus={() => onSelectedJointChange(joint.jointId)}
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
                    onFocus={() => onSelectedJointChange(joint.jointId)}
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
        <span><strong>MODEL PREVIEW ONLY</strong> · 两条七轴臂的拖拽和数值编辑只改变幽灵模型。</span>
      </div>
      <div className="jointSecondaryActions">
        <Hint content="Aethor_robo 固件和反馈协议尚未完成">
          <button type="button" disabled>读取当前</button>
        </Hint>
        <button type="button" onClick={() => alignTarget(modelPoseDeg)}>目标对齐模型</button>
        <button type="button" onClick={resetPreview}>恢复模型位</button>
      </div>
      <div className="jointCommandResult unsupported" role="status">
        <strong>HARDWARE PENDING</strong>
        <span>未定义串口、反馈、使能、停止、限位或速度契约；Dummy 指令集不会复用于此设备。</span>
      </div>
      <Hint content="Aethor_robo 硬件和规范指令集完成并通过独立验收前，控制台没有发送路径。">
        <button className="sendGroupButton" type="button" disabled>硬件协议待实现 · 禁止下发</button>
      </Hint>
    </aside>
  );
}

function ConsoleBottom({ activeJoints }: { activeJoints: readonly RobotJointProfile[] }) {
  const target = useAethorRoboConsoleStore((state) => state.targetPositionsDeg);
  const errors = useMemo(
    () => modelPoseDeg.map((value, index) => (target[index] ?? value) - value),
    [target]
  );
  return (
    <section className="twinBottom">
      <DualArmSummary target={target} />
      <div className="jointTableWrap">
        <table className="dataTable">
          <thead><tr><th>JOINT</th><th>MODEL (deg)</th><th>TARGET (deg)</th><th>DELTA (deg)</th><th>STATE</th></tr></thead>
          <tbody>
            {activeJoints.map((joint) => {
              const index = joint.protocolIndex;
              return (
                <tr key={joint.jointId} data-joint-id={joint.jointId}>
                  <th>{joint.displayName}</th>
                  <td data-column="actual">{modelPoseDeg[index]?.toFixed(2)}</td>
                  <td data-column="target">{target[index]?.toFixed(2)}</td>
                  <td>{(errors[index] ?? 0).toFixed(2)}</td>
                  <td><span className="tableState showcase">PREVIEW</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="recentEvents">
        <div className="bottomTitle"><strong>模型接入状态</strong><span>NO HARDWARE</span></div>
        {consoleEvents.map((event) => (
          <div className="eventRow" key={event.id}>
            <time>{event.id.toUpperCase()}</time>
            <span className={`eventMark ${event.severity}`} />
            <div><strong>{event.title}</strong><small>{event.detail}</small></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SceneButton({ label, active, onClick, children }: {
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

function ModelTree({ selectedJointId, onSelectedJointChange }: {
  selectedJointId: string;
  onSelectedJointChange: (jointId: string) => void;
}) {
  return (
    <div className="modelTree">
      <TreeNode icon={<Boxes size={14} />} label="aethor_robo" meta="SPACE ROBOT">
        <TreeNode icon={<Box size={14} />} label="satellite_base_link" meta="BASE" />
        {aethorRoboJointGroups.map((group) => (
          <TreeNode key={group.groupId} icon={<GitBranch size={14} />} label={group.displayName} meta="7-DOF">
            {groupJoints(group).map((joint) => (
              <TreeNode
                key={joint.jointId}
                icon={<GitBranch size={14} />}
                label={joint.urdfJointName}
                meta={joint.displayName}
                selected={joint.jointId === selectedJointId}
                onSelect={() => onSelectedJointChange(joint.jointId)}
              />
            ))}
          </TreeNode>
        ))}
        <TreeNode icon={<Box size={14} />} label="wheel_link_1…6" meta="MODEL ONLY" />
      </TreeNode>
    </div>
  );
}

function groupJoints(group: RobotJointGroupV1) {
  const jointIds = new Set(group.jointIds);
  return aethorRoboProfile.joints.filter((joint) => jointIds.has(joint.jointId));
}

function TreeNode({ icon, label, meta, selected, onSelect, children }: {
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
    ['showTcpFrame', '双臂 TCP 坐标系', <Crosshair size={14} />],
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

function ModelDiagnostics({ modelState, capability }: {
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
      <div><dt>PROFILE</dt><dd>{aethorRoboProfile.profileId}</dd></div>
      <div><dt>SCHEMA</dt><dd>1.0 · VALID</dd></div>
      <div><dt>URDF</dt><dd>{modelState.toUpperCase()}</dd></div>
      <div><dt>QUALITY</dt><dd>{capability.quality.toUpperCase()}</dd></div>
      <div><dt>CONTROL JOINTS</dt><dd>14 · 2 × 7-DOF</dd></div>
      <div><dt>WHEEL JOINTS</dt><dd>6 · MODEL ONLY</dd></div>
      <div><dt>UP AXIS</dt><dd>Z</dd></div>
      <div><dt>RENDERER / CONTROLS</dt><dd>{resources.renderers} / {resources.controls}</dd></div>
      <div><dt>MODEL ROOTS</dt><dd>{resources.modelRoots}</dd></div>
      <div><dt>GEOMETRY / MATERIAL</dt><dd>{resources.geometries} / {resources.materials}</dd></div>
      <div><dt>DRAG SESSION</dt><dd>{resources.dragSessions}</dd></div>
      <div><dt>PROTOCOL</dt><dd>PENDING / OFFLINE</dd></div>
      <div><dt>EFFORT / VELOCITY</dt><dd>UNVERIFIED</dd></div>
    </dl>
  );
}

function DualArmSummary({ target }: { target: readonly number[] }) {
  return (
    <div className="miniTrend dualArmOverview">
      <div className="bottomTitle"><strong>双臂目标概览</strong><span>14 DOF · LOCAL</span></div>
      <div className="armOverviewRows">
        {aethorRoboJointGroups.map((group) => {
          const joints = groupJoints(group);
          const changed = joints.filter((joint) => Math.abs((target[joint.protocolIndex] ?? 0) - (modelPoseDeg[joint.protocolIndex] ?? 0)) > 0.001).length;
          const maximumDelta = Math.max(0, ...joints.map((joint) => Math.abs((target[joint.protocolIndex] ?? 0) - (modelPoseDeg[joint.protocolIndex] ?? 0))));
          return (
            <div className="armOverviewRow" key={group.groupId}>
              <div><strong>{group.displayName}</strong><span>{changed}/7 TARGETS CHANGED</span></div>
              <output>{maximumDelta.toFixed(2)}°</output>
              <small>MAX MODEL DELTA</small>
            </div>
          );
        })}
      </div>
      <div className="trendFooter"><span>MODEL POSE</span><span>NO FEEDBACK</span><span>NO SEND PATH</span></div>
    </div>
  );
}
