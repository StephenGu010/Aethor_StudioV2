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
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DirectCommandResult } from '@aethor/contracts';
import { formatDummyCommand } from '@aethor/contracts/dummy-ascii-v1';
import { Hint } from '../../components/ui/Hint';
import { SourceTag } from '../../components/ui/SourceTag';
import type { SceneCapabilityState } from '../../components/visualization/sceneCapabilities';
import {
  getSceneResourceSnapshot,
  subscribeSceneResources
} from '../../components/visualization/sceneResourceTracker';
import { FloatingToolWindow } from '../../components/workbench/FloatingToolWindow';
import { getJointKeyboardNudgeDeg } from '../../domain/jointInteraction';
import { showcaseEvents, showcaseJointFrame, showcaseSignalSeries } from '../../fixtures/showcase';
import { runGatewayCommandLifecycle } from '../../integrations/GatewayCommandLifecycle';
import { robotGateway } from '../../integrations/gatewayInstance';
import { dummyProfile, dummyUrdfUrl } from '../../profile/dummyProfile';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { type ToolWindowId, useWorkbenchStore } from '../../stores/useWorkbenchStore';

const RobotScene = lazy(() => import('../../components/visualization/RobotScene')
  .then((module) => ({ default: module.RobotScene })));

export function DummyConsole() {
  const target = useRobotSessionStore((state) => state.targetPositionsDeg);
  const setJointTarget = useRobotSessionStore((state) => state.setJointTarget);
  const alignTarget = useRobotSessionStore((state) => state.alignTarget);
  const loadShowcasePose = useRobotSessionStore((state) => state.loadShowcasePose);
  const session = useGatewayRuntimeStore((state) => state.session);
  const jointState = useGatewayRuntimeStore((state) => state.jointState);
  const capabilities = useGatewayRuntimeStore((state) => state.capabilities);
  const commandAuditStatus = useGatewayRuntimeStore((state) => state.commandAuditStatus);
  const latchedSafetyResult = useGatewayRuntimeStore((state) => state.latchedSafetyResult);
  const transportWarning = useGatewayRuntimeStore((state) => state.transportWarning);
  const lastCommandResult = useGatewayRuntimeStore((state) => state.lastCommandResult);
  const protocolFrames = useGatewayRuntimeStore((state) => state.operatorProtocolFrames);
  const directCommandHistory = useGatewayRuntimeStore((state) => state.directCommandHistory);
  const setSession = useGatewayRuntimeStore((state) => state.setSession);
  const setJointState = useGatewayRuntimeStore((state) => state.setJointState);
  const markTelemetryDegraded = useGatewayRuntimeStore((state) => state.markTelemetryDegraded);
  const modelTreeOpen = useWorkbenchStore((state) => state.windows.modelTree.open);
  const displayOpen = useWorkbenchStore((state) => state.windows.display.open);
  const diagnosticsOpen = useWorkbenchStore((state) => state.windows.diagnostics.open);
  const toggleWindow = useWorkbenchStore((state) => state.toggleWindow);
  const resetLayout = useWorkbenchStore((state) => state.resetLayout);
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedJointId, setSelectedJointId] = useState(dummyProfile.joints[0]!.jointId);
  const [sceneCapability, setSceneCapability] = useState<SceneCapabilityState>({ supported: true, quality: 'balanced' });
  const [reading, setReading] = useState(false);
  const [sending, setSending] = useState(false);
  const [directResult, setDirectResult] = useState<DirectCommandResult | null>(null);
  const [directRequestId, setDirectRequestId] = useState<string | null>(null);
  const previousConnectionState = useRef(session.connectionState);
  const engineeringDirect = capabilities?.commandPolicy === 'engineering' && capabilities.directCommand;
  const negotiatedSpeedLimit = engineeringDirect
    ? capabilities.engineeringJointSpeedMaxDegS
    : capabilities?.jointGroupSpeedLimitDegS ?? null;
  const [speedDegS, setSpeedDegS] = useState(1);
  const measuredFrame = jointState.profileId === dummyProfile.profileId
    && jointState.source === 'measured'
    && jointState.positionsDeg.length === dummyProfile.model.dof;
  const actual = measuredFrame ? jointState.positionsDeg : showcaseJointFrame.positionsDeg;
  const actualSource = measuredFrame ? 'measured' as const : 'showcase' as const;
  const errors = useMemo(() => actual.map((value, index) => (target[index] ?? value) - value), [actual, target]);
  const recentEvents = useMemo(() => measuredFrame
    ? protocolFrames.length
      ? protocolFrames.slice(-4).reverse().map((frame) => ({
          id: frame.id,
          timestampUtc: frame.timestampUtc,
          severity: frame.direction === 'error' ? 'warning' : 'info',
          title: `${frame.direction.toUpperCase()} · ${frame.parsedKind}`
        }))
      : [{ id: 'device-waiting', timestampUtc: session.timestampUtc, severity: 'info', title: 'Waiting for device frames' }]
    : showcaseEvents.slice(0, 4).map(({ id, timestampUtc, severity, title }) => ({ id, timestampUtc, severity, title })), [measuredFrame, protocolFrames, session.timestampUtc]);
  const selectedJoint = dummyProfile.joints.find((joint) => joint.jointId === selectedJointId);
  const selectedTargetDeg = selectedJoint ? target[selectedJoint.protocolIndex] ?? 0 : 0;
  const sendDisabledReason = getJointGroupDisabledReason({
    capabilities,
    session,
    jointState,
    commandAuditStatus,
    latchedSafetyResult,
    transportWarning,
    speedDegS,
    sending
  });
  const displayedDirectResult = directRequestId
    ? directCommandHistory.find((result) => result.requestId === directRequestId) ?? directResult
    : directResult;
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

  useEffect(() => {
    const previous = previousConnectionState.current;
    previousConnectionState.current = session.connectionState;
    if (previous === 'offline' || session.connectionState !== 'offline') return;
    setSelectedJointId(dummyProfile.joints[0]!.jointId);
    setDirectResult(null);
    setDirectRequestId(null);
    setCameraResetSignal((value) => value + 1);
  }, [session.connectionState]);

  useEffect(() => {
    if (lastCommandResult?.commandKind === 'stopAndDisable'
      && lastCommandResult.status === 'completed'
      && lastCommandResult.evidence === 'feedbackConfirmed') {
      setDirectResult(null);
      setDirectRequestId(null);
    }
  }, [lastCommandResult]);

  const readCurrent = async () => {
    if (!robotGateway.capabilities.readOnlyConnection || session.connectionState !== 'connected' || reading) return;
    setReading(true);
    try {
      const [nextSession, nextJointState] = await Promise.all([
        robotGateway.getSession(),
        robotGateway.getJointState()
      ]);
      setSession(nextSession);
      setJointState(nextJointState);
    } catch (error) {
      markTelemetryDegraded(error instanceof Error ? error.message : '读取 Dummy 当前状态失败');
    } finally {
      setReading(false);
    }
  };

  const sendJointGroup = async () => {
    if (sendDisabledReason || sending) return;
    const completionDescription = `模式 ${session.controlMode ?? '—'} 使用人工控制：上位机只确认串口写入，不等待队列号、ok 或到位。`;
    if (!window.confirm(`确认工作区无人、物理急停可用，并以 ${speedDegS.toFixed(2)} deg/s 下发六轴目标。${completionDescription}请观察实机后再决定下一步。是否继续？`)) return;
    setSending(true);
    setDirectResult(null);
    const commandId = crypto.randomUUID();
    setDirectRequestId(engineeringDirect ? commandId : null);
    try {
      if (engineeringDirect) {
        setDirectResult(await robotGateway.sendDirectCommand({
          requestId: commandId,
          sessionId: session.sessionId,
          profileId: dummyProfile.profileId,
          line: formatDummyCommand({ type: 'jointGroup', positionsDeg: target, speedDegS })
        }));
        return;
      }
      await runGatewayCommandLifecycle({
        gateway: robotGateway,
        intent: { commandId, sessionId: session.sessionId, commandKind: 'jointGroup' },
        operationLabel: '整组关节下发',
        execute: () => robotGateway.sendJointGroup({
          commandId,
          sessionId: session.sessionId,
          profileId: dummyProfile.profileId,
          positionsDeg: target,
          speedDegS
        })
      });
    } catch (cause) {
      if (engineeringDirect) {
        setDirectResult({
          requestId: commandId,
          sessionId: session.sessionId,
          status: 'failed',
          evidence: 'none',
          normalizedLine: '',
          message: `${cause instanceof Error ? cause.message : '整组关节请求失败'}；是否已写入不确定，请查看 TX 与实机后人工决定，系统不会自动重发`,
          timestampUtc: new Date().toISOString()
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="twinPage" data-profile-id={dummyProfile.profileId}>
      <section className="scenePanel">
        <div className="sceneStage">
          <div className="sceneToolbar" aria-label="三维场景工具">
            <SceneButton label="模型树" active={modelTreeOpen} onClick={() => toggleWindow('modelTree')}><GitBranch size={16} /></SceneButton>
            <SceneButton label="显示设置" active={displayOpen} onClick={() => toggleWindow('display')}><Settings2 size={16} /></SceneButton>
            <SceneButton label="诊断" active={diagnosticsOpen} onClick={() => toggleWindow('diagnostics')}><ScanLine size={16} /></SceneButton>
            <span className="toolbarDivider" />
            <SceneButton label="重置相机" onClick={() => setCameraResetSignal((value) => value + 1)}><Focus size={16} /></SceneButton>
            <SceneButton label="重置工具窗布局" onClick={resetLayout}><RotateCcw size={16} /></SceneButton>
          </div>
          <Suspense fallback={<div className="sceneModuleLoading">LOADING 3D MODULE</div>}>
            <RobotScene
              profile={dummyProfile}
              urdfUrl={dummyUrdfUrl}
              actualPositionsDeg={actual}
              targetPositionsDeg={target}
              selectedJointId={selectedJointId}
              cameraResetSignal={cameraResetSignal}
              settings={settings}
              onSelectedJointChange={setSelectedJointId}
              onJointTargetChange={setJointTarget}
              onModelState={setModelState}
              onCapabilityState={setSceneCapability}
            />
          </Suspense>
          <div className="feedbackHud">
            <div><small>{measuredFrame ? 'DEVICE FEEDBACK' : 'SHOWCASE FEEDBACK'}</small><strong>{measuredFrame ? `${jointState.validity.toUpperCase()} · #${jointState.sequence}` : 'STATIC CAPTURE'}</strong></div>
            <div><span>J1</span><strong>{actual[0]?.toFixed(2)}°</strong></div>
            <div><span>J2</span><strong>{actual[1]?.toFixed(2)}°</strong></div>
            <div><span>J3</span><strong>{actual[2]?.toFixed(2)}°</strong></div>
            <div><span>FRAME</span><strong>BASE / Z-UP</strong></div>
          </div>
          <div className="sceneLegend">
            <div><span className="legendLine solid" /> SOLID · {measuredFrame ? 'FEEDBACK' : 'SHOWCASE'}</div>
            <div><span className="legendLine ghost" /> GHOST · TARGET</div>
            <div><SourceTag source={actualSource} /></div>
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
              <span>Selected · {selectedJoint.displayName}</span>
              <strong>{selectedTargetDeg.toFixed(2)}°</strong>
              <small>拖动黄色旋转环 · 方向键 ±0.1° · Shift ±1°</small>
            </div>
          )}
          {modelState === 'error' && sceneCapability.supported && (
            <div className="sceneModelError" role="alert"><strong>MODEL RESOURCE FAILED</strong><span>Dummy URDF、mesh 或关节映射加载失败；不会产生硬件命令。</span></div>
          )}
          <div className={`modelLoadState state-${modelState}`}><span className={`statusDot ${modelState === 'ready' ? 'ok' : modelState === 'error' ? 'error' : 'warning'}`} />{!sceneCapability.supported ? 'WEBGL UNAVAILABLE' : modelState === 'ready' ? 'Dummy · URDF READY' : modelState === 'error' ? 'URDF LOAD FAILED' : 'LOADING MODEL'}</div>
          <FloatingToolWindow id="modelTree" title="模型结构"><ModelTree selectedJointId={selectedJointId} onSelectedJointChange={setSelectedJointId} /></FloatingToolWindow>
          <FloatingToolWindow id="display" title="显示设置"><DisplaySettings /></FloatingToolWindow>
          <FloatingToolWindow id="diagnostics" title="模型诊断"><ModelDiagnostics modelState={modelState} capability={sceneCapability} measured={measuredFrame} /></FloatingToolWindow>
        </div>
      </section>

      <aside className="jointControlPanel">
        <div className="panelTitle"><div><h2>六轴关节控制</h2><span>Dummy · #GETJPOS 设备角</span></div><SourceTag source="commanded" /></div>
        <div className="controlModeTabs"><button type="button" className="active">关节</button><Hint content="首版不包含末端位姿与 IK"><button type="button" disabled>末端位姿</button></Hint></div>
        <div className="jointRows">
          {dummyProfile.joints.map((joint) => {
            const current = actual[joint.protocolIndex] ?? 0;
            const targetValue = target[joint.protocolIndex] ?? current;
            return (
              <div className={joint.jointId === selectedJointId ? 'jointRow selected' : 'jointRow'} key={joint.jointId}>
                <div className="jointRowHeader">
                  <button type="button" className="jointSelectButton" aria-label={`选择 ${joint.displayName} 关节`} aria-pressed={joint.jointId === selectedJointId} onClick={() => setSelectedJointId(joint.jointId)}>{joint.displayName}</button>
                  <span>{joint.lowerDeg.toFixed(0)}</span><span className="jointLimitSpacer" /><span>{joint.upperDeg.toFixed(0)}</span><output>{current.toFixed(2)}°</output>
                </div>
                <div className="jointInputRow">
                  <input aria-label={`${joint.displayName} 目标角度`} type="range" min={joint.lowerDeg} max={joint.upperDeg} step={0.1} value={targetValue} onFocus={() => setSelectedJointId(joint.jointId)} onChange={(event) => setJointTarget(joint.protocolIndex, Number(event.currentTarget.value))} />
                  <label><input aria-label={`${joint.displayName} 目标角度数值`} type="number" min={joint.lowerDeg} max={joint.upperDeg} step={0.1} value={Number(targetValue.toFixed(2))} onFocus={() => setSelectedJointId(joint.jointId)} onChange={(event) => setJointTarget(joint.protocolIndex, Number(event.currentTarget.value))} /><span>deg</span></label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="jointSecondaryActions">
          <Hint content={robotGateway.capabilities.readOnlyConnection ? session.connectionState === 'connected' ? '刷新当前会话与六轴反馈' : '请先在“设备与模型”连接 Dummy' : '当前浏览器没有 C# 网关'}><button type="button" disabled={!robotGateway.capabilities.readOnlyConnection || session.connectionState !== 'connected' || reading} onClick={() => void readCurrent()}>{reading ? '读取中…' : '读取当前'}</button></Hint>
          <button type="button" onClick={() => alignTarget(actual)}>目标对齐当前</button>
          <button type="button" onClick={loadShowcasePose}>加载展示位</button>
        </div>
        <div className="jointCommandEnvelope">
          <label><span>Command speed</span><input aria-label="Dummy 整组速度" type="number" min={0.01} max={negotiatedSpeedLimit ?? undefined} step={0.1} value={speedDegS} disabled={negotiatedSpeedLimit === null} onChange={(event) => setSpeedDegS(Number(event.currentTarget.value))} /><small>deg/s</small></label>
          <span>{engineeringDirect && negotiatedSpeedLimit !== null
            ? `Mode ${session.controlMode ?? '—'} · manual confirmation · ≤ ${negotiatedSpeedLimit.toFixed(2)} deg/s`
            : negotiatedSpeedLimit === null
              ? 'Engineering direct gateway unavailable'
              : `Verified limit ≤ ${negotiatedSpeedLimit.toFixed(2)} deg/s`}</span>
        </div>
        {displayedDirectResult && <div className={`jointCommandResult ${displayedDirectResult.status}`} role="status"><strong>{getDirectResultLabel(displayedDirectResult)}</strong><span>{displayedDirectResult.message}</span></div>}
        {lastCommandResult?.commandKind === 'jointGroup' && <div className={`jointCommandResult ${lastCommandResult.status}`} role="status"><strong>{lastCommandResult.status.toUpperCase()}</strong><span>{lastCommandResult.message}</span></div>}
        <Hint content={sendDisabledReason ?? (engineeringDirect ? '写入完成即释放操作；设备是否接收和到位由操作者结合实机与 #GETJPOS 判断。' : '执行前再次确认现场安全；完成只以实测反馈稳定收敛为准。')}><button className="sendGroupButton" type="button" disabled={Boolean(sendDisabledReason)} onClick={() => void sendJointGroup()}>{sending ? '正在写入串口…' : '下发整组关节角'}</button></Hint>
      </aside>

      <section className="twinBottom">
        <MiniTrend />
        <div className="jointTableWrap"><table className="dataTable"><thead><tr><th>JOINT</th><th>{measuredFrame ? '#GETJPOS' : 'SHOWCASE'} (deg)</th><th>TARGET (deg)</th><th>ERROR (deg)</th><th>STATE</th></tr></thead><tbody>{dummyProfile.joints.map((joint) => { const index = joint.protocolIndex; return <tr key={joint.jointId} data-joint-id={joint.jointId}><th>{joint.displayName}</th><td data-column="actual">{actual[index]?.toFixed(2)}</td><td data-column="target">{target[index]?.toFixed(2)}</td><td>{(errors[index] ?? 0).toFixed(2)}</td><td><span className={measuredFrame ? `tableState ${jointState.validity}` : 'tableState showcase'}>{measuredFrame ? jointState.validity.toUpperCase() : 'SHOWCASE'}</span></td></tr>; })}</tbody></table></div>
        <div className="recentEvents"><div className="bottomTitle"><strong>最近事件</strong><span>{measuredFrame ? 'DEVICE SESSION' : 'SHOWCASE CAPTURE'}</span></div>{recentEvents.map((event) => <div className="eventRow" key={event.id}><time>{formatTime(event.timestampUtc)}</time><span className={`eventMark ${event.severity}`} /><div><strong>{event.title}</strong></div></div>)}</div>
      </section>
    </div>
  );
}

function getJointGroupDisabledReason({ capabilities, session, jointState, commandAuditStatus, latchedSafetyResult, transportWarning, speedDegS, sending }: {
  capabilities: ReturnType<typeof useGatewayRuntimeStore.getState>['capabilities'];
  session: ReturnType<typeof useGatewayRuntimeStore.getState>['session'];
  jointState: ReturnType<typeof useGatewayRuntimeStore.getState>['jointState'];
  commandAuditStatus: ReturnType<typeof useGatewayRuntimeStore.getState>['commandAuditStatus'];
  latchedSafetyResult: ReturnType<typeof useGatewayRuntimeStore.getState>['latchedSafetyResult'];
  transportWarning: string | null;
  speedDegS: number;
  sending: boolean;
}) {
  if (sending) return '已有整组命令正在执行';
  if (!capabilities?.hardwareCommands) return '本机网关没有硬件命令能力';
  const engineering = capabilities.commandPolicy === 'engineering' && capabilities.directCommand;
  const supervised = capabilities.commandPolicy === 'supervised'
    && capabilities.supportedCommands.includes('jointGroup')
    && capabilities.jointGroupSpeedLimitDegS !== null
    && capabilities.jointGroupCompletion !== null;
  if (!engineering && !supervised) return '请启动 engineering 调试网关，或配置完整的受监督运动包络';
  if (session.connectionState !== 'connected' || session.profileId !== dummyProfile.profileId) return 'Dummy 尚未连接';
  if (session.validity !== 'valid' && !engineering) return session.motorState === 'disabled'
    ? '停止已确认，正在恢复模式与关节反馈；恢复 VALID 后可重新使能'
    : '正在恢复新鲜会话反馈';
  if (session.motorState !== 'enabled' || session.controlMode === null) return '需要已使能电机和有效模式';
  if (jointState.profileId !== dummyProfile.profileId || jointState.source !== 'measured' || jointState.positionsDeg.length !== dummyProfile.model.dof) return '当前 Dummy 会话尚未取得六轴实测反馈';
  if (!engineering && transportWarning) return '实时遥测处于降级状态';
  if (!engineering && commandAuditStatus !== 'ready') return '权威命令审计尚未恢复';
  if (!engineering && latchedSafetyResult) return '存在未解除的命令安全联锁';
  const speedLimit = engineering ? capabilities.engineeringJointSpeedMaxDegS : capabilities.jointGroupSpeedLimitDegS;
  if (speedLimit === null || !Number.isFinite(speedDegS) || speedDegS <= 0 || speedDegS > speedLimit) return `速度必须在 0–${speedLimit?.toFixed(2) ?? 'N/A'} deg/s 内`;
  return null;
}

function getDirectResultLabel(result: DirectCommandResult) {
  if (result.status === 'queued') return 'QUEUED · GATEWAY ACCEPTED';
  if (result.status === 'sent') return 'SENT · MANUAL CONFIRM';
  return result.status.toUpperCase();
}

function SceneButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Hint content={label}><button className={active ? 'active' : undefined} type="button" onClick={onClick} aria-label={label}>{children}</button></Hint>;
}

function ModelTree({ selectedJointId, onSelectedJointChange }: { selectedJointId: string; onSelectedJointChange: (jointId: string) => void }) {
  return <div className="modelTree"><TreeNode icon={<Boxes size={14} />} label="dummy" meta="ROBOT"><TreeNode icon={<Box size={14} />} label="base_link" meta="BASE" />{dummyProfile.joints.map((joint, index) => <TreeNode key={joint.jointId} icon={<GitBranch size={14} />} label={joint.urdfJointName} meta={`J${index + 1}`} selected={joint.jointId === selectedJointId} onSelect={() => onSelectedJointChange(joint.jointId)} />)}</TreeNode></div>;
}

function TreeNode({ icon, label, meta, selected, onSelect, children }: { icon: React.ReactNode; label: string; meta: string; selected?: boolean; onSelect?: () => void; children?: React.ReactNode }) {
  return <div className="treeBranch">{onSelect ? <button type="button" className={selected ? 'treeNode selected' : 'treeNode'} onClick={onSelect} aria-pressed={selected}>{icon}<span>{label}</span><small>{meta}</small></button> : <div className="treeNode">{icon}<span>{label}</span><small>{meta}</small></div>}{children && <div className="treeChildren">{children}</div>}</div>;
}

function DisplaySettings() {
  const store = useWorkbenchStore();
  const options = [
    ['showVisual', '视觉模型', <Box size={14} />], ['showCollision', '碰撞模型', <Boxes size={14} />],
    ['showGrid', '地面网格', <Grid3X3 size={14} />], ['showShadows', '实时阴影', <SunMedium size={14} />],
    ['showLighting', '场景光照', <Lightbulb size={14} />], ['showBaseFrame', '基座坐标系', <Axis3D size={14} />],
    ['showTcpFrame', 'TCP 坐标系', <Crosshair size={14} />], ['showJointAxes', '关节轴', <Axis3D size={14} />]
  ] as const;
  return <div className="toggleList">{options.map(([key, label, icon]) => <label key={key}><span>{icon}{label}</span><input type="checkbox" checked={store[key]} onChange={(event) => store.setDisplay(key, event.currentTarget.checked)} /></label>)}</div>;
}

function ModelDiagnostics({ modelState, capability, measured }: { modelState: 'loading' | 'ready' | 'error'; capability: SceneCapabilityState; measured: boolean }) {
  const resources = useSyncExternalStore(subscribeSceneResources, getSceneResourceSnapshot, getSceneResourceSnapshot);
  return <dl className="diagnosticList" data-testid="scene-resource-diagnostics"><div><dt>PROFILE</dt><dd>{dummyProfile.profileId}</dd></div><div><dt>URDF</dt><dd>{modelState.toUpperCase()}</dd></div><div><dt>QUALITY</dt><dd>{capability.quality.toUpperCase()}</dd></div><div><dt>DOF</dt><dd>6</dd></div><div><dt>RENDERER / CONTROLS</dt><dd>{resources.renderers} / {resources.controls}</dd></div><div><dt>GEOMETRY / MATERIAL</dt><dd>{resources.geometries} / {resources.materials}</dd></div><div><dt>SOURCE</dt><dd>{measured ? 'MEASURED' : 'SHOWCASE'}</dd></div><div><dt>PROTOCOL</dt><dd>dummy-ascii-v1</dd></div><div><dt>EFFORT / VELOCITY</dt><dd>UNVERIFIED</dd></div></dl>;
}

function MiniTrend() {
  const series = showcaseSignalSeries.find((item) => item.descriptor.signalId === 'j1.actual.position');
  const points = series?.samples.filter((_, index) => index % 12 === 0).map((sample) => sample.value ?? 0) ?? [];
  const minimum = Math.min(...points); const maximum = Math.max(...points); const range = Math.max(0.01, maximum - minimum);
  const path = points.map((value, index) => `${index === 0 ? 'M' : 'L'} ${((index / Math.max(1, points.length - 1)) * 100).toFixed(2)} ${(88 - ((value - minimum) / range) * 65).toFixed(2)}`).join(' ');
  return <div className="miniTrend"><div className="bottomTitle"><strong>关节角趋势</strong><span>30 s · J1 SHOWCASE</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="J1 展示关节角趋势"><path className="trendGrid" d="M0 25H100M0 50H100M0 75H100" /><path className="trendLine" d={path} /></svg><div className="trendFooter"><span>{minimum.toFixed(2)}°</span><span>SHOWCASE CAPTURE</span><span>{maximum.toFixed(2)}°</span></div></div>;
}

function formatTime(timestampUtc: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestampUtc));
}
