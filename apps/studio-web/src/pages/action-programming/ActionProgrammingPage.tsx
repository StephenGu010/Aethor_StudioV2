import type {
  ActionProgramRunStartRequestV1,
  ActionProgramV1,
  ActionWaypointV1,
  DummyControlMode
} from '@aethor/contracts';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CircleAlert,
  Check,
  Copy,
  Download,
  Eye,
  FileJson2,
  FolderOpen,
  Plus,
  Play,
  ShieldAlert,
  Square,
  Trash2,
  Upload
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hint } from '../../components/ui/Hint';
import {
  actionProgramFileName,
  cloneActionProgram,
  createActionProgramV1,
  createActionWaypointV1,
  MAX_ACTION_PROGRAM_BYTES,
  parseActionProgramJson,
  serializeActionProgramV1,
  updatePostArrivalWait
} from '../../domain/actionProgram';
import { showcaseJointFrame } from '../../fixtures/showcase';
import { dummyProfile } from '../../profile/dummyProfile';
import {
  isActionProgramDirty,
  MAX_LOCAL_ACTION_PROGRAMS,
  useActionProgramStore
} from '../../stores/useActionProgramStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';

export function ActionProgrammingPage({ gateway = robotGateway }: { gateway?: RobotGatewayV1 }) {
  const programs = useActionProgramStore((state) => state.programs);
  const storageWarnings = useActionProgramStore((state) => state.storageWarnings);
  const draft = useActionProgramStore((state) => state.draft);
  const draftOrigin = useActionProgramStore((state) => state.draftOrigin);
  const selectedWaypointId = useActionProgramStore((state) => state.selectedWaypointId);
  const previewedWaypointId = useActionProgramStore((state) => state.previewedWaypointId);
  const store = useActionProgramStore();
  const gatewaySession = useGatewayRuntimeStore((state) => state.session);
  const gatewayJointState = useGatewayRuntimeStore((state) => state.jointState);
  const gatewayCapabilities = useGatewayRuntimeStore((state) => state.capabilities);
  const actionProgramRun = useGatewayRuntimeStore((state) => state.actionProgramRun);
  const setActionProgramRun = useGatewayRuntimeStore((state) => state.setActionProgramRun);
  const targetPositionsDeg = useRobotSessionStore((state) => state.targetPositionsDeg);
  const loadActionPreview = useRobotSessionStore((state) => state.loadActionPreview);
  const importInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [autoSaveErrors, setAutoSaveErrors] = useState<string[]>([]);
  const [runOperationPending, setRunOperationPending] = useState(false);
  const savedProgram = draft ? programs[draft.programId] : undefined;
  const dirty = isActionProgramDirty(draft, savedProgram);
  const selectedWaypoint = draft?.waypoints.find((waypoint) => waypoint.waypointId === selectedWaypointId) ?? null;
  const library = useMemo(
    () => Object.values(programs).sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc)),
    [programs]
  );
  const captureAvailable = gatewaySession.connectionState === 'connected'
    && gatewaySession.profileId === dummyProfile.profileId
    && gatewaySession.validity === 'valid'
    && gatewayJointState.profileId === dummyProfile.profileId
    && gatewayJointState.source === 'measured'
    && gatewayJointState.validity === 'valid'
    && gatewayJointState.positionsDeg.length === dummyProfile.model.dof;
  const runActive = actionProgramRun !== null
    && actionProgramRun.sessionId === gatewaySession.sessionId
    && ['starting', 'running', 'stopping'].includes(actionProgramRun.state);
  const runValidation = useMemo(
    () => actionRunValidation(draft, gatewaySession, gatewayJointState, gatewayCapabilities),
    [draft, gatewayCapabilities, gatewayJointState, gatewaySession]
  );

  useEffect(() => {
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    if (!draft || !dirty) {
      setAutoSaveErrors([]);
      return;
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      const result = useActionProgramStore.getState().saveDraft(new Date().toISOString());
      if (result.status === 'invalid') setAutoSaveErrors(result.errors);
      else if (result.status === 'conflict') setAutoSaveErrors(['导入文档与动作库中的稳定 ID 冲突，尚未覆盖原文档。']);
      else setAutoSaveErrors([]);
    }, 350);
  }, [draft, dirty]);

  useEffect(() => {
    const flush = () => {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      const state = useActionProgramStore.getState();
      if (isActionProgramDirty(state.draft, state.draft ? state.programs[state.draft.programId] : undefined)) {
        state.saveDraft(new Date().toISOString());
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const flushCurrentDraft = () => {
    const state = useActionProgramStore.getState();
    const currentSaved = state.draft ? state.programs[state.draft.programId] : undefined;
    if (!isActionProgramDirty(state.draft, currentSaved)) return true;
    const result = state.saveDraft(new Date().toISOString());
    if (result.status === 'invalid') {
      setAutoSaveErrors(result.errors);
      return false;
    }
    if (result.status === 'conflict') {
      setAutoSaveErrors(['导入文档与动作库中的稳定 ID 冲突，尚未覆盖原文档。']);
      return false;
    }
    setAutoSaveErrors([]);
    return true;
  };
  const clearFeedback = () => {
    setNotice(null);
    setErrors([]);
  };
  const createProgram = () => {
    if (!flushCurrentDraft()) return;
    clearFeedback();
    store.setDraft(createActionProgramV1({
      programId: crypto.randomUUID(),
      name: '未命名动作程序',
      timestampUtc: new Date().toISOString()
    }), 'new');
    setNotice('已创建本地动作程序；有效更改会自动保存。');
  };
  const createShowcaseExample = () => {
    if (!flushCurrentDraft()) return;
    clearFeedback();
    const timestampUtc = new Date().toISOString();
    const waypoint = createActionWaypointV1({
      waypointId: crypto.randomUUID(),
      sequence: 1,
      positionsDeg: showcaseJointFrame.positionsDeg,
      source: 'showcaseExample',
      timestampUtc
    });
    store.setDraft({
      ...createActionProgramV1({
        programId: crypto.randomUUID(),
        name: 'Dummy 展示点位示例',
        timestampUtc,
        source: 'showcaseExample',
        waypoints: [waypoint]
      }),
      notes: '仅用于离线编辑与预览，不是实机安全动作。',
      waypoints: [{ ...waypoint, notes: 'SHOWCASE DATA；不得解释为安全回位姿态。' }]
    }, 'showcaseExample');
    setNotice('已创建 SHOWCASE 示例；不会产生连接、回包或硬件命令。');
  };
  const duplicateProgram = () => {
    if (!draft || !flushCurrentDraft()) return;
    const currentDraft = useActionProgramStore.getState().draft;
    if (!currentDraft) return;
    const timestampUtc = new Date().toISOString();
    const duplicate: ActionProgramV1 = {
      ...cloneActionProgram(currentDraft),
      programId: crypto.randomUUID(),
      name: `${currentDraft.name} 副本`,
      revision: 1,
      createdAtUtc: timestampUtc,
      updatedAtUtc: timestampUtc,
      source: 'authored',
      waypoints: currentDraft.waypoints.map((waypoint) => ({ ...waypoint, waypointId: crypto.randomUUID() }))
    };
    clearFeedback();
    store.setDraft(duplicate, 'duplicate');
    setNotice('副本已创建；原程序和副本均由本地动作库自动保存。');
  };
  const openProgram = (programId: string) => {
    if (!flushCurrentDraft()) return;
    clearFeedback();
    store.openSavedProgram(programId);
  };
  const importProgram = async (file: File | undefined) => {
    if (!file || !flushCurrentDraft()) return;
    clearFeedback();
    if (file.size > MAX_ACTION_PROGRAM_BYTES) {
      setErrors(['动作程序超过 1 MiB 文件上限，未读取文件内容。']);
      return;
    }
    const result = parseActionProgramJson(await file.text(), dummyProfile);
    if (!result.valid || !result.program) {
      setErrors(result.errors);
      return;
    }
    const existing = programs[result.program.programId];
    const differs = Boolean(existing && JSON.stringify(existing) !== JSON.stringify(result.program));
    if (existing && !differs) {
      store.openSavedProgram(existing.programId);
      setNotice(`${file.name} 与本地 revision 一致，已打开现有文档。`);
      return;
    }
    const overwrite = differs && existing
      ? window.confirm(`动作库中已存在同一稳定 ID 的“${existing.name}”。确认以导入文档覆盖并创建新 revision？`)
      : false;
    if (existing && !overwrite && differs) {
      setNotice('已取消覆盖；动作库保持不变。');
      return;
    }
    store.setDraft(result.program, 'imported');
    const saved = store.saveDraft(new Date().toISOString(), overwrite);
    if (saved.status === 'invalid') setErrors(saved.errors);
    else setNotice(`已校验并自动保存 ${file.name}。`);
  };
  const exportProgram = () => {
    if (!draft) return;
    clearFeedback();
    try {
      const blob = new Blob([serializeActionProgramV1(draft, dummyProfile)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = actionProgramFileName(draft);
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('已导出当前校验通过的动作文档；导出不等于保存或安装。');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '动作导出失败']);
    }
  };
  const addWaypoint = (source: ActionWaypointV1['source']) => {
    if (!draft) return;
    clearFeedback();
    if (source === 'measuredCapture' && !captureAvailable) {
      setErrors(['采集当前点需要已连接、有效且新鲜的六轴 MEASURED 反馈。']);
      return;
    }
    const positionsDeg = source === 'measuredCapture'
      ? gatewayJointState.positionsDeg
      : source === 'showcaseExample'
        ? showcaseJointFrame.positionsDeg
        : targetPositionsDeg;
    const timestampUtc = source === 'measuredCapture' ? gatewayJointState.timestampUtc : new Date().toISOString();
    const mode = source !== 'showcaseExample' && gatewaySession.controlMode !== null
      ? gatewaySession.controlMode
      : 2;
    const added = store.addWaypoint(createActionWaypointV1({
      waypointId: crypto.randomUUID(),
      sequence: draft.waypoints.length + 1,
      positionsDeg,
      source,
      timestampUtc,
      mode
    }));
    if (!added) setErrors(['动作程序已达到 256 个点位上限。']);
  };
  const previewWaypoint = (waypoint: ActionWaypointV1) => {
    if (!loadActionPreview(waypoint.positionsDeg)) {
      setErrors([`${waypoint.name} 不是完整的六轴有限设备角，无法预览。`]);
      return;
    }
    store.markPreviewed(waypoint.waypointId);
    setErrors([]);
    setNotice(`${waypoint.name} 已按原始设备角写入 Dummy 本地目标草稿；未发送硬件命令，也不会覆盖 Aethor_robo 控制台目标。`);
  };
  const startProgram = async () => {
    clearFeedback();
    if (!flushCurrentDraft()) return;
    const currentDraft = useActionProgramStore.getState().draft;
    const validation = actionRunValidation(currentDraft, gatewaySession, gatewayJointState, gatewayCapabilities);
    if (!validation.ready || !currentDraft) {
      setErrors([validation.reason]);
      return;
    }
    if (!window.confirm(
      `确认运行“${currentDraft.name}”？\n\n网关将按 ${currentDraft.speedDegS} deg/s `
      + `${currentDraft.loopEnabled ? '循环' : '单次'}写入 ${currentDraft.waypoints.length} 个点位。`
      + '\n运行进度只证明串口写入与估算等待，不证明机械臂到位。'
    )) return;

    const request: ActionProgramRunStartRequestV1 = {
      contractVersion: '1.0',
      runId: crypto.randomUUID(),
      programId: currentDraft.programId,
      revision: currentDraft.revision,
      sessionId: gatewaySession.sessionId,
      profileId: 'dummy-6dof',
      source: 'authored',
      speedDegS: currentDraft.speedDegS,
      loopEnabled: currentDraft.loopEnabled,
      waypoints: currentDraft.waypoints.map((waypoint) => ({
        waypointId: waypoint.waypointId,
        name: waypoint.name,
        positionsDeg: [...waypoint.positionsDeg],
        mode: waypoint.mode,
        postDispatchWaitMs: waypoint.postArrivalWait.kind === 'durationAfterConfirmed'
          ? waypoint.postArrivalWait.durationMs
          : 0,
        source: waypoint.source === 'measuredCapture' ? 'measuredCapture' : 'manual'
      }))
    };
    setRunOperationPending(true);
    try {
      const snapshot = await gateway.startActionProgram(request);
      setActionProgramRun(snapshot);
      if (snapshot.state === 'rejected' || snapshot.state === 'failed') setErrors([snapshot.message]);
      else setNotice('动作程序已交给 C# 网关；文档后续编辑不会改变本次运行快照。');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '动作程序启动失败']);
    } finally {
      setRunOperationPending(false);
    }
  };
  const stopProgram = async () => {
    clearFeedback();
    setRunOperationPending(true);
    try {
      const snapshot = await gateway.stopActionProgram();
      setActionProgramRun(snapshot);
      if (snapshot.state === 'failed') setErrors([snapshot.message]);
      else setNotice(snapshot.message);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '动作程序停止失败']);
    } finally {
      setRunOperationPending(false);
    }
  };

  return (
    <div className="workspacePage actionPage">
      <section className="actionWorkbench panelSurface">
        <div className="actionToolbar">
          <div>
            <span>ACTION PROGRAM · ENGINEERING</span>
            <h2>{draft?.name ?? '动作程序'}</h2>
          </div>
          <div className="actionToolbarButtons">
            <button type="button" onClick={createProgram}><Plus size={14} />新建</button>
            <button type="button" onClick={() => importInputRef.current?.click()}><Upload size={14} />导入</button>
            <button type="button" disabled={!draft} onClick={duplicateProgram}><Copy size={14} />复制</button>
            <button type="button" disabled={!draft} onClick={exportProgram}><Download size={14} />导出</button>
            <span className={`actionAutoSaveBadge ${dirty ? 'pending' : ''}`}><Check size={13} />{dirty ? '自动保存中' : '已自动保存'}</span>
            <input
              ref={importInputRef}
              className="visuallyHidden"
              type="file"
              accept=".json,.aethor-action.json,application/json"
              aria-label="导入动作 JSON 文件"
              onChange={(event) => {
                void importProgram(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </div>
        </div>

        <div className="actionEditorBody">
          <aside className="actionLibrary" aria-label="已保存动作库">
            <div className="actionPaneTitle"><span>LOCAL LIBRARY</span><strong>{library.length} / {MAX_LOCAL_ACTION_PROGRAMS}</strong></div>
            <div className="actionLibraryList">
              {library.length === 0 && <p>尚无动作程序。新建或导入后会自动保存到本机。</p>}
              {library.map((program) => (
                <div className={`actionLibraryItem${draft?.programId === program.programId ? ' active' : ''}`} key={program.programId}>
                  <button type="button" onClick={() => openProgram(program.programId)}>
                    <strong>{program.name}</strong>
                    <small>REV {program.revision} · {program.waypoints.length} POINTS</small>
                  </button>
                  <Hint content="删除本机已保存文档；不会影响导出文件">
                    <button
                      className="iconButton"
                      type="button"
                      aria-label={`删除 ${program.name}`}
                      onClick={() => {
                        if (window.confirm(`从本机动作库删除“${program.name}”？`)) store.deleteSavedProgram(program.programId);
                      }}
                    ><Trash2 size={13} /></button>
                  </Hint>
                </div>
              ))}
            </div>
          </aside>

          <div className="actionSequencePane">
            {!draft ? (
              <div className="actionEmptyState">
                <div className="actionEmptyIcon"><FileJson2 size={27} /></div>
                <span>VERSIONED LOCAL DOCUMENT</span>
                <h2>创建或导入动作程序</h2>
                <p>创建动作文档后，可采集 #GETJPOS 实测角并交给本机 C# 网关单次或循环运行。</p>
                <div className="actionEmptyActions">
                  <button type="button" onClick={createProgram}><Plus size={15} />新建空白程序</button>
                  <button type="button" onClick={() => importInputRef.current?.click()}><FolderOpen size={15} />导入 JSON</button>
                  <button type="button" onClick={createShowcaseExample}><FileJson2 size={15} />展示示例</button>
                </div>
              </div>
            ) : (
              <>
                <div className="actionSequenceHeader">
                  <div><span>WAYPOINT SEQUENCE</span><strong>{draft.waypoints.length} / 256</strong></div>
                  <div>
                    <button type="button" onClick={() => addWaypoint('manual')}><Plus size={13} />添加目标草稿</button>
                    <Hint content={captureAvailable ? '写入当前新鲜 MEASURED 六轴反馈' : '需要已连接、有效且新鲜的六轴 MEASURED 反馈'}>
                      <button type="button" disabled={!captureAvailable} onClick={() => addWaypoint('measuredCapture')}>采集当前点</button>
                    </Hint>
                    <button type="button" onClick={() => addWaypoint('showcaseExample')}>添加 SHOWCASE</button>
                  </div>
                </div>
                <div className="actionWaypointList">
                  {draft.waypoints.length === 0 && (
                    <div className="actionSequenceEmpty"><Braces size={22} /><strong>程序中没有点位</strong><span>从 Dummy 本地目标草稿添加，或在真实新鲜反馈可用时采集当前点。</span></div>
                  )}
                  {draft.waypoints.map((waypoint, index) => (
                    <div className={`actionWaypointRow${selectedWaypointId === waypoint.waypointId ? ' selected' : ''}`} key={waypoint.waypointId}>
                      <button className="actionWaypointMain" type="button" onClick={() => store.selectWaypoint(waypoint.waypointId)}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div><strong>{waypoint.name}</strong><small>MODE {waypoint.mode} · {sourceLabel(waypoint.source)}</small></div>
                        <code>{waypoint.positionsDeg.map((value) => value.toFixed(1)).join(' / ')}</code>
                      </button>
                      <div className="actionWaypointControls">
                        <Hint content="上移点位"><button type="button" aria-label={`${waypoint.name} 上移`} disabled={index === 0} onClick={() => store.moveWaypoint(waypoint.waypointId, -1)}><ArrowUp size={13} /></button></Hint>
                        <Hint content="下移点位"><button type="button" aria-label={`${waypoint.name} 下移`} disabled={index === draft.waypoints.length - 1} onClick={() => store.moveWaypoint(waypoint.waypointId, 1)}><ArrowDown size={13} /></button></Hint>
                        <Hint content="仅加载到目标草稿，不发送"><button type="button" aria-label={`预览 ${waypoint.name}`} onClick={() => previewWaypoint(waypoint)}><Eye size={13} /></button></Hint>
                        <Hint content="删除点位并自动保存"><button className="dangerIcon" type="button" aria-label={`删除 ${waypoint.name}`} onClick={() => store.removeWaypoint(waypoint.waypointId)}><Trash2 size={13} /></button></Hint>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="actionStatusBar">
          <span><span className={`statusDot ${dirty ? 'warning' : draft ? 'ok' : 'muted'}`} /> {draft ? dirty ? 'AUTO-SAVING' : 'AUTO-SAVED' : 'DOCUMENT EMPTY'}</span>
          <span><Braces size={13} /> ACTIONPROGRAM V1.0</span>
          <span>{runActive
            ? `RUN ${actionProgramRun?.state.toUpperCase()} · CYCLE ${actionProgramRun?.completedCycles ?? 0}`
            : previewedWaypointId ? 'TARGET PREVIEW · NO SEND' : runValidation.ready ? 'ENGINEERING RUN READY' : 'NO EXECUTION PATH'}</span>
        </div>
      </section>

      <aside className="actionInspector panelSurface">
        <div className="cardHeading">
          <div><span>DOCUMENT INSPECTOR</span><h2>{selectedWaypoint ? '点位属性' : '程序属性'}</h2></div>
          <div className={`actionDraftBadge ${dirty ? 'dirty' : 'saved'}`}>{draft ? dirty ? 'SAVING' : 'AUTO-SAVED' : 'EMPTY'}</div>
        </div>

        {draft ? (
          <div className="actionInspectorScroll">
            <fieldset className="actionFieldset">
              <legend>PROGRAM</legend>
              <label><span>名称</span><input aria-label="动作程序名称" value={draft.name} maxLength={80} onChange={(event) => store.updateDraftMeta({ name: event.currentTarget.value, notes: draft.notes })} /></label>
              <label><span>说明</span><textarea aria-label="动作程序说明" value={draft.notes} maxLength={2000} onChange={(event) => store.updateDraftMeta({ name: draft.name, notes: event.currentTarget.value })} /></label>
              <div className="actionFieldPair actionExecutionDefaults">
                <label><span>默认速度</span><span className="actionNumberWithUnit"><input aria-label="动作默认速度" type="number" min="0.01" max="100" step="1" value={draft.speedDegS} onChange={(event) => {
                  const speedDegS = Number(event.currentTarget.value);
                  if (!Number.isFinite(speedDegS)) return;
                  store.updateDraftMeta({ speedDegS: Math.min(100, Math.max(0.01, speedDegS)) });
                }} /><small>deg/s</small></span></label>
                <label className="actionLoopSwitch"><span>循环执行</span><span><input aria-label="循环执行" type="checkbox" role="switch" checked={draft.loopEnabled} onChange={(event) => store.updateDraftMeta({ loopEnabled: event.currentTarget.checked })} /><strong>{draft.loopEnabled ? 'ON' : 'OFF'}</strong></span></label>
              </div>
              <p className="actionFieldHelp">默认速度为 20 deg/s。循环开关随文档保存；循环运行会持续到操作员停止。</p>
              <dl className="actionDocumentMeta">
                <div><dt>PROFILE</dt><dd>{draft.profileId}</dd></div>
                <div><dt>REVISION</dt><dd>{draft.revision}</dd></div>
                <div><dt>SOURCE</dt><dd>{draft.source.toUpperCase()}</dd></div>
                <div><dt>DRAFT ORIGIN</dt><dd>{draftOrigin?.toUpperCase()}</dd></div>
              </dl>
            </fieldset>

            {selectedWaypoint && (
              <fieldset className="actionFieldset">
                <legend>SELECTED WAYPOINT</legend>
                <label><span>点位名称</span><input aria-label="点位名称" value={selectedWaypoint.name} maxLength={80} onChange={(event) => store.updateWaypoint(selectedWaypoint.waypointId, { name: event.currentTarget.value })} /></label>
                <div className="actionJointGrid">
                  {dummyProfile.joints.map((joint) => (
                    <label key={joint.jointId}>
                      <span>{joint.displayName} <small>deg</small></span>
                      <input
                        type="number"
                        aria-label={`${joint.displayName} 点位角度`}
                        step="0.1"
                        readOnly={selectedWaypoint.source === 'measuredCapture'}
                        title={selectedWaypoint.source === 'measuredCapture' ? '实测采集角度按 #GETJPOS 原样保留；如需调整，请新建手动点位。' : undefined}
                        value={selectedWaypoint.positionsDeg[joint.protocolIndex] ?? 0}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          if (!Number.isFinite(value)) return;
                          const positionsDeg = [...selectedWaypoint.positionsDeg];
                          positionsDeg[joint.protocolIndex] = value;
                          store.updateWaypoint(selectedWaypoint.waypointId, { positionsDeg });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="actionFieldPair">
                  <label><span>模式</span><select aria-label="点位控制模式" value={selectedWaypoint.mode} onChange={(event) => store.updateWaypoint(selectedWaypoint.waypointId, { mode: Number(event.currentTarget.value) as DummyControlMode })}><option value="1">MODE 1</option><option value="2">MODE 2</option><option value="3">MODE 3</option></select></label>
                  <label><span>估算运动后附加等待 ms</span><input type="number" aria-label="估算运动后附加等待毫秒" min="0" max="600000" step="100" value={selectedWaypoint.postArrivalWait.kind === 'durationAfterConfirmed' ? selectedWaypoint.postArrivalWait.durationMs : 0} onChange={(event) => store.updateWaypoint(selectedWaypoint.waypointId, { postArrivalWait: updatePostArrivalWait(Number(event.currentTarget.value)) })} /></label>
                </div>
                <label><span>点位备注</span><textarea aria-label="点位备注" value={selectedWaypoint.notes} maxLength={500} onChange={(event) => store.updateWaypoint(selectedWaypoint.waypointId, { notes: event.currentTarget.value })} /></label>
                <div className={`actionSourceNotice source-${selectedWaypoint.source}`}><strong>{sourceLabel(selectedWaypoint.source)}</strong><span>{sourceDescription(selectedWaypoint)}</span></div>
                <button className="actionPreviewButton" type="button" onClick={() => previewWaypoint(selectedWaypoint)}><Eye size={14} />加载到 Dummy 本地目标草稿</button>
              </fieldset>
            )}

          </div>
        ) : (
          <div className="actionInspectorEmpty"><FileJson2 size={24} /><span>选择已保存文档，或创建新的离线动作程序。</span></div>
        )}

        {storageWarnings.length > 0 && (
          <div className="actionFeedback error" role="alert">
            <CircleAlert size={14} />
            <div>{storageWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>
          </div>
        )}

        {(notice || errors.length > 0 || autoSaveErrors.length > 0) && (
          <div className={errors.length > 0 || autoSaveErrors.length > 0 ? 'actionFeedback error' : 'actionFeedback'} role={errors.length > 0 || autoSaveErrors.length > 0 ? 'alert' : 'status'}>
            <CircleAlert size={14} />
            <div>{notice && <span>{notice}</span>}{[...errors, ...autoSaveErrors].map((error) => <span key={error}>{error}</span>)}</div>
          </div>
        )}

        <div className={`actionSafetyNotice${runActive ? ' active' : ''}`}>
          <ShieldAlert size={16} />
          <div><strong>{runActive ? 'ENGINEERING RUN ACTIVE' : 'TRANSPORT-WRITTEN EXECUTION'}</strong><span>{actionProgramRun?.message ?? runValidation.reason}。当前未确认物理到位，软件停止不能替代物理急停。</span></div>
        </div>
        <div className="actionPrimaryArea">
          {runActive ? (
            <button type="button" className="dangerAction" disabled={runOperationPending || actionProgramRun?.state === 'stopping'} onClick={() => void stopProgram()}><Square size={15} />停止程序</button>
          ) : (
            <Hint content={runValidation.ready ? '提交当前不可变动作快照到 C# 网关' : runValidation.reason}>
              <button type="button" disabled={!runValidation.ready || runOperationPending} onClick={() => void startProgram()}><Play size={15} />运行程序</button>
            </Hint>
          )}
          <small>{runActive ? 'SERIAL SCHEDULE ACTIVE · PHYSICAL ARRIVAL UNCONFIRMED' : 'C# GATEWAY OWNS SERIAL, PACING AND STOP'}</small>
        </div>
      </aside>
    </div>
  );
}

function actionRunValidation(
  draft: ActionProgramV1 | null,
  session: ReturnType<typeof useGatewayRuntimeStore.getState>['session'],
  jointState: ReturnType<typeof useGatewayRuntimeStore.getState>['jointState'],
  capabilities: ReturnType<typeof useGatewayRuntimeStore.getState>['capabilities']
): { ready: true; reason: string } | { ready: false; reason: string } {
  if (!draft) return { ready: false, reason: '请先创建或打开动作程序' };
  if (draft.source !== 'authored') return { ready: false, reason: 'SHOWCASE 程序不能发送到硬件' };
  if (draft.waypoints.length === 0) return { ready: false, reason: '动作程序至少需要一个点位' };
  if (draft.waypoints.some((waypoint) => waypoint.source === 'showcaseExample')) return { ready: false, reason: '请移除 SHOWCASE 点位后再运行' };
  if (session.connectionState !== 'connected' || session.validity !== 'valid' || session.profileId !== 'dummy-6dof') return { ready: false, reason: '需要已连接且新鲜有效的 Dummy 会话' };
  if (jointState.profileId !== 'dummy-6dof' || jointState.source !== 'measured'
    || jointState.validity !== 'valid' || jointState.positionsDeg.length !== 6
    || jointState.positionsDeg.some((value) => !Number.isFinite(value))) {
    return { ready: false, reason: '需要新鲜有效的六轴 #GETJPOS 起始角' };
  }
  if (session.motorState !== 'enabled') return { ready: false, reason: '请先使能电机' };
  if (session.controlMode === null || draft.waypoints.some((waypoint) => waypoint.mode !== session.controlMode)) return { ready: false, reason: '全部点位模式必须与当前设备模式一致' };
  if (capabilities?.commandPolicy !== 'engineering' || !capabilities.directCommand) return { ready: false, reason: '当前 C# 网关未启用 engineering 动作运行能力' };
  if (capabilities.engineeringJointSpeedMaxDegS === null || draft.speedDegS > capabilities.engineeringJointSpeedMaxDegS) return { ready: false, reason: '动作速度超过网关固件输入上限' };
  if (draft.waypoints.some((waypoint) => waypoint.positionsDeg.length !== 6 || waypoint.positionsDeg.some((value) => !Number.isFinite(value)))) return { ready: false, reason: '点位必须包含六个有限设备角' };
  return { ready: true, reason: '动作程序可提交；运行前会再次确认' };
}

function sourceLabel(source: ActionWaypointV1['source']) {
  return source === 'measuredCapture' ? 'MEASURED CAPTURE' : source === 'showcaseExample' ? 'SHOWCASE EXAMPLE' : 'MANUAL DRAFT';
}

function sourceDescription(waypoint: ActionWaypointV1) {
  if (waypoint.source === 'measuredCapture') return `采集时间 ${waypoint.capturedAtUtc ?? 'UNAVAILABLE'}；仅记录当时反馈。`;
  if (waypoint.source === 'showcaseExample') return '静态展示值，不是实机示教点或安全姿态。';
  return '来自本地目标草稿或人工编辑，未经过设备反馈确认。';
}
