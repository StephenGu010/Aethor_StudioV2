import type { ActionProgramV1, ActionWaypointV1, DummyControlMode } from '@aethor/contracts';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CircleAlert,
  Copy,
  Download,
  Eye,
  FileJson2,
  FolderOpen,
  Plus,
  Save,
  ShieldAlert,
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
import { clampJointTargetDeg } from '../../domain/jointInteraction';
import { showcaseJointFrame } from '../../fixtures/showcase';
import { dummyProfile } from '../../profile/dummyProfile';
import {
  isActionProgramDirty,
  MAX_LOCAL_ACTION_PROGRAMS,
  useActionProgramStore
} from '../../stores/useActionProgramStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';

export function ActionProgrammingPage() {
  const programs = useActionProgramStore((state) => state.programs);
  const storageWarnings = useActionProgramStore((state) => state.storageWarnings);
  const draft = useActionProgramStore((state) => state.draft);
  const draftOrigin = useActionProgramStore((state) => state.draftOrigin);
  const selectedWaypointId = useActionProgramStore((state) => state.selectedWaypointId);
  const previewedWaypointId = useActionProgramStore((state) => state.previewedWaypointId);
  const store = useActionProgramStore();
  const gatewaySession = useGatewayRuntimeStore((state) => state.session);
  const gatewayJointState = useGatewayRuntimeStore((state) => state.jointState);
  const targetPositionsDeg = useRobotSessionStore((state) => state.targetPositionsDeg);
  const alignTarget = useRobotSessionStore((state) => state.alignTarget);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
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

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const confirmDraftReplacement = () => !dirty || window.confirm('当前动作草稿尚未保存。确认放弃这些更改并继续？');
  const clearFeedback = () => {
    setNotice(null);
    setErrors([]);
  };
  const createProgram = () => {
    if (!confirmDraftReplacement()) return;
    clearFeedback();
    store.setDraft(createActionProgramV1({
      programId: crypto.randomUUID(),
      name: '未命名动作程序',
      timestampUtc: new Date().toISOString()
    }), 'new');
    setNotice('已创建本地草稿；保存前不会写入动作库。');
  };
  const createShowcaseExample = () => {
    if (!confirmDraftReplacement()) return;
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
    if (!draft) return;
    const timestampUtc = new Date().toISOString();
    const duplicate: ActionProgramV1 = {
      ...cloneActionProgram(draft),
      programId: crypto.randomUUID(),
      name: `${draft.name} 副本`,
      revision: 1,
      createdAtUtc: timestampUtc,
      updatedAtUtc: timestampUtc,
      source: 'authored',
      waypoints: draft.waypoints.map((waypoint) => ({ ...waypoint, waypointId: crypto.randomUUID() }))
    };
    clearFeedback();
    store.setDraft(duplicate, 'duplicate');
    setNotice('副本已作为未保存草稿创建，原程序未被修改。');
  };
  const openProgram = (programId: string) => {
    if (!confirmDraftReplacement()) return;
    clearFeedback();
    store.openSavedProgram(programId);
  };
  const saveProgram = (overwriteConflict = false) => {
    clearFeedback();
    const result = store.saveDraft(new Date().toISOString(), overwriteConflict);
    if (result.status === 'invalid') {
      setErrors(result.errors);
    } else if (result.status === 'conflict') {
      if (window.confirm(`动作库中已存在同一稳定 ID 的“${result.existing.name}”。确认覆盖并创建新 revision？`)) {
        saveProgram(true);
      }
    } else if (result.status === 'saved') {
      setNotice(`已显式保存 revision ${result.program.revision}。`);
    } else if (result.status === 'unchanged') {
      setNotice('当前文档与已保存 revision 一致，无需重复写入。');
    }
  };
  const importProgram = async (file: File | undefined) => {
    if (!file || !confirmDraftReplacement()) return;
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
    store.setDraft(result.program, 'imported');
    setNotice(`已校验并载入 ${file.name}；尚未保存到本地动作库。`);
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
    const added = store.addWaypoint(createActionWaypointV1({
      waypointId: crypto.randomUUID(),
      sequence: draft.waypoints.length + 1,
      positionsDeg,
      source,
      timestampUtc
    }));
    if (!added) setErrors(['动作程序已达到 256 个点位上限。']);
  };
  const previewWaypoint = (waypoint: ActionWaypointV1) => {
    alignTarget(waypoint.positionsDeg);
    store.markPreviewed(waypoint.waypointId);
    setErrors([]);
    setNotice(`${waypoint.name} 已写入 Dummy 本地目标草稿；未发送硬件命令，也不会覆盖 Aethor_robo 控制台目标。`);
  };

  return (
    <div className="workspacePage actionPage">
      <section className="actionWorkbench panelSurface">
        <div className="actionToolbar">
          <div>
            <span>ACTION DOCUMENT · OFFLINE EDITOR</span>
            <h2>{draft?.name ?? '动作程序'}</h2>
          </div>
          <div className="actionToolbarButtons">
            <button type="button" onClick={createProgram}><Plus size={14} />新建</button>
            <button type="button" onClick={() => importInputRef.current?.click()}><Upload size={14} />导入</button>
            <button type="button" disabled={!draft} onClick={duplicateProgram}><Copy size={14} />复制</button>
            <button type="button" disabled={!draft} onClick={exportProgram}><Download size={14} />导出</button>
            <button className="primaryAction" type="button" disabled={!draft || !dirty} onClick={() => saveProgram()}><Save size={14} />保存</button>
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
              {library.length === 0 && <p>尚无已保存文档。新建或导入后需要显式保存。</p>}
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
                <p>Phase 6A 只提供离线文档、点位编辑和目标草稿预览。执行器属于 Gate B 后的 Phase 6B，本页面没有硬件发送路径。</p>
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
                        <Hint content="删除点位"><button className="dangerIcon" type="button" aria-label={`删除 ${waypoint.name}`} onClick={() => {
                          if (window.confirm(`删除点位“${waypoint.name}”？`)) store.removeWaypoint(waypoint.waypointId);
                        }}><Trash2 size={13} /></button></Hint>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="actionStatusBar">
          <span><span className={`statusDot ${dirty ? 'warning' : draft ? 'ok' : 'muted'}`} /> {draft ? dirty ? 'DRAFT DIRTY' : 'SAVED REVISION' : 'DOCUMENT EMPTY'}</span>
          <span><Braces size={13} /> ACTIONPROGRAM V1.0</span>
          <span>{previewedWaypointId ? 'TARGET PREVIEW · NO SEND' : 'NO EXECUTION PATH'}</span>
        </div>
      </section>

      <aside className="actionInspector panelSurface">
        <div className="cardHeading">
          <div><span>DOCUMENT INSPECTOR</span><h2>{selectedWaypoint ? '点位属性' : '程序属性'}</h2></div>
          <div className={`actionDraftBadge ${dirty ? 'dirty' : 'saved'}`}>{draft ? dirty ? 'UNSAVED' : 'SAVED' : 'EMPTY'}</div>
        </div>

        {draft ? (
          <div className="actionInspectorScroll">
            <fieldset className="actionFieldset">
              <legend>PROGRAM</legend>
              <label><span>名称</span><input aria-label="动作程序名称" value={draft.name} maxLength={80} onChange={(event) => store.updateDraftMeta({ name: event.currentTarget.value, notes: draft.notes })} /></label>
              <label><span>说明</span><textarea aria-label="动作程序说明" value={draft.notes} maxLength={2000} onChange={(event) => store.updateDraftMeta({ name: draft.name, notes: event.currentTarget.value })} /></label>
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
                        min={joint.lowerDeg}
                        max={joint.upperDeg}
                        step="0.1"
                        value={selectedWaypoint.positionsDeg[joint.protocolIndex] ?? 0}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value);
                          const clamped = clampJointTargetDeg(dummyProfile, joint.protocolIndex, value);
                          if (clamped === undefined) return;
                          const positionsDeg = [...selectedWaypoint.positionsDeg];
                          positionsDeg[joint.protocolIndex] = clamped;
                          store.updateWaypoint(selectedWaypoint.waypointId, { positionsDeg });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="actionFieldPair">
                  <label><span>模式</span><select aria-label="点位控制模式" value={selectedWaypoint.mode} onChange={(event) => store.updateWaypoint(selectedWaypoint.waypointId, { mode: Number(event.currentTarget.value) as DummyControlMode })}><option value="1">MODE 1</option><option value="2">MODE 2</option><option value="3">MODE 3</option></select></label>
                  <label><span>到位确认后等待 ms</span><input type="number" aria-label="到位确认后等待毫秒" min="0" max="600000" step="100" value={selectedWaypoint.postArrivalWait.kind === 'durationAfterConfirmed' ? selectedWaypoint.postArrivalWait.durationMs : 0} onChange={(event) => store.updateWaypoint(selectedWaypoint.waypointId, { postArrivalWait: updatePostArrivalWait(Number(event.currentTarget.value)) })} /></label>
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

        {(notice || errors.length > 0) && (
          <div className={errors.length > 0 ? 'actionFeedback error' : 'actionFeedback'} role={errors.length > 0 ? 'alert' : 'status'}>
            <CircleAlert size={14} />
            <div>{notice && <span>{notice}</span>}{errors.map((error) => <span key={error}>{error}</span>)}</div>
          </div>
        )}

        <div className="actionSafetyNotice">
          <ShieldAlert size={16} />
          <div><strong>PHASE 6B LOCKED</strong><span>当前只有离线编辑和目标草稿预览。逐点 runner 必须等待 Gate B 和 `completed + feedbackConfirmed` 能力。</span></div>
        </div>
        <div className="actionPrimaryArea">
          <Hint content="Gate B 未关闭；当前应用没有动作执行器或硬件发送路径">
            <button type="button" disabled><ShieldAlert size={15} />运行程序 · 不可用</button>
          </Hint>
          <small>NO SERIAL WRITE · NO TIMER-BASED COMPLETION</small>
        </div>
      </aside>
    </div>
  );
}

function sourceLabel(source: ActionWaypointV1['source']) {
  return source === 'measuredCapture' ? 'MEASURED CAPTURE' : source === 'showcaseExample' ? 'SHOWCASE EXAMPLE' : 'MANUAL DRAFT';
}

function sourceDescription(waypoint: ActionWaypointV1) {
  if (waypoint.source === 'measuredCapture') return `采集时间 ${waypoint.capturedAtUtc ?? 'UNAVAILABLE'}；仅记录当时反馈。`;
  if (waypoint.source === 'showcaseExample') return '静态展示值，不是实机示教点或安全姿态。';
  return '来自本地目标草稿或人工编辑，未经过设备反馈确认。';
}
