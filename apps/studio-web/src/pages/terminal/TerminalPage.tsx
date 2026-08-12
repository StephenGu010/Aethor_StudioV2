import { Clipboard, Download, Eye, EyeOff, Filter, Search, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SourceTag } from '../../components/ui/SourceTag';
import type { ConnectionState, DataSource, DirectCommandResult, ProtocolFrame, Validity } from '@aethor/contracts';
import { validateDummyCommand } from '../../domain/dummyCommand';
import { buildProtocolLogText } from '../../domain/protocolExport';
import { showcaseProtocolFrames } from '../../fixtures/showcase';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { isRoutineJointPositionFrame, useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';

type DirectionFilter = 'all' | ProtocolFrame['direction'];
const quickCommands = ['#GETJPOS', '#GETMODE', '#GETENABLE', '#CMDMODE 1', '#CMDMODE 2', '#CMDMODE 3', '!START', '!STOP', '!DISABLE'];

export function TerminalPage({ gateway = robotGateway }: { gateway?: RobotGatewayV1 }) {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showJointPositionFrames, setShowJointPositionFrames] = useState(false);
  const [hiddenFrameIds, setHiddenFrameIds] = useState<Set<string>>(() => new Set());
  const [command, setCommand] = useState('#GETJPOS');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [directResult, setDirectResult] = useState<DirectCommandResult | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const runtimeFrames = useGatewayRuntimeStore((state) => showJointPositionFrames
    ? state.protocolFrames
    : state.operatorProtocolFrames);
  const session = useGatewayRuntimeStore((state) => state.session);
  const jointState = useGatewayRuntimeStore((state) => state.jointState);
  const gatewayConfigured = gateway.capabilities.readOnlyConnection;
  const captureFrames = gatewayConfigured
    ? runtimeFrames
    : showJointPositionFrames
      ? showcaseProtocolFrames
      : showcaseProtocolFrames.filter((frame) => !isRoutineJointPositionFrame(frame));
  const liveCapture = gatewayConfigured;
  const captureState = getCaptureState(gatewayConfigured, session.connectionState, session.validity, runtimeFrames.length);
  const validation = validateDummyCommand(command);
  const sendDisabledReason = getDirectSendDisabledReason({ gateway, session, jointState, command, validation, sending });
  const visibleFrames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return captureFrames.filter((frame) =>
      !hiddenFrameIds.has(frame.id)
      &&
      (direction === 'all' || frame.direction === direction)
      && (!needle || `${frame.raw} ${frame.parsedKind}`.toLowerCase().includes(needle))
    );
  }, [captureFrames, direction, hiddenFrameIds, query]);

  useEffect(() => setHiddenFrameIds(new Set()), [gatewayConfigured, session.sessionId]);

  useEffect(() => {
    if (!autoScroll || document.visibilityState === 'hidden') return;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [autoScroll, visibleFrames]);

  const copyVisible = async () => {
    try {
      await navigator.clipboard.writeText(buildProtocolLogText(visibleFrames));
      setCopyFeedback(`已复制 ${visibleFrames.length} 帧`);
    } catch {
      setCopyFeedback('复制失败；浏览器未授予剪贴板权限');
    }
  };

  const exportLog = () => {
    const text = buildProtocolLogText(visibleFrames);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = liveCapture ? 'aethor-terminal-session.txt' : 'aethor-terminal-showcase.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const sendDirect = async () => {
    if (sendDisabledReason || sending) return;
    setSending(true);
    setDirectResult(null);
    try {
      setDirectResult(await gateway.sendDirectCommand({
        requestId: crypto.randomUUID(),
        sessionId: session.sessionId,
        profileId: 'dummy-6dof',
        line: command.trim()
      }));
    } catch (cause) {
      setDirectResult({
        requestId: 'transport-failure',
        sessionId: session.sessionId,
        status: 'failed',
        evidence: 'none',
        normalizedLine: command.trim().slice(0, 255),
        message: `${cause instanceof Error ? cause.message : '直连命令请求失败'}；是否已写入不确定，请查看 TX 与实机后人工决定，系统不会自动重发`,
        timestampUtc: new Date().toISOString()
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="workspacePage terminalPage">
      <section className="terminalMain panelSurface">
        <div className="workspaceToolbar terminalToolbar">
          <label className="searchField"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索帧、类型或错误" /></label>
          <div className="segmentedFilter" aria-label="方向过滤">
            {(['all', 'tx', 'rx', 'error'] as const).map((item) => <button className={direction === item ? 'active' : ''} type="button" key={item} onClick={() => setDirection(item)}>{item.toUpperCase()}</button>)}
          </div>
          <label className="checkControl"><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.currentTarget.checked)} /> AUTO SCROLL</label>
          <button type="button" onClick={() => void copyVisible()} disabled={!visibleFrames.length}><Clipboard size={14} />复制</button>
          <button type="button" onClick={exportLog} disabled={!visibleFrames.length}><Download size={14} />导出</button>
          <button type="button" onClick={() => setHiddenFrameIds((current) => new Set([...current, ...captureFrames.map((frame) => frame.id)].slice(-256)))} disabled={!visibleFrames.length}><Trash2 size={14} />清空视图</button>
          <span className="copyFeedback" aria-live="polite">{copyFeedback}</span>
        </div>

        <div className="terminalCaptureBanner">
          <div><span className={`statusDot ${captureState.tone}`} /><strong>{captureState.label}</strong><span>{captureState.detail}</span></div>
          <span className="terminalCaptureActions">
            <button
              type="button"
              className={showJointPositionFrames ? 'active' : ''}
              aria-pressed={showJointPositionFrames}
              aria-label={showJointPositionFrames ? '隐藏 GETJPOS' : '显示 GETJPOS'}
              title="只切换终端显示；后台关节反馈持续采集"
              onClick={() => setShowJointPositionFrames((current) => !current)}
            >
              {showJointPositionFrames ? <EyeOff size={13} /> : <Eye size={13} />}
              {showJointPositionFrames ? '隐藏 GETJPOS' : '显示 GETJPOS'}
            </button>
            <SourceTag source={captureState.source} />
          </span>
        </div>
        <div className="terminalLog" aria-live="polite" ref={logRef}>
          {visibleFrames.length ? visibleFrames.map((frame) => (
            <div className={`protocolRow direction-${frame.direction}`} key={frame.id}>
              <time>{formatTimestamp(frame.timestampUtc)}</time>
              <span className="directionBadge">{frame.direction.toUpperCase()}</span>
              <code>{frame.raw}</code>
              <span className="protocolKind">{frame.parsedKind}</span>
              <SourceTag source={frame.source} />
            </div>
          )) : <div className="emptyState">{gatewayConfigured
            ? showJointPositionFrames
              ? '当前网关会话缓冲区没有匹配的协议帧；未使用展示记录回填。'
              : '当前没有匹配的操作事件；GETJPOS 轮询仅从终端隐藏，设备反馈仍在后台更新，未使用展示记录回填。'
            : '当前视图没有协议帧。原始展示采集未被修改。'}</div>}
        </div>

        <div className="commandComposer">
          <div className="commandComposerHeader">
            <div><strong>Dummy 指令</strong><span>DUMMY ASCII V1 · ENGINEERING DIRECT</span></div>
            <span className={`expertState ${gateway.capabilities.rawCommand ? 'unlocked' : ''}`}>{gateway.capabilities.rawCommand ? 'DIRECT READY' : 'LOCAL VALIDATION'}</span>
          </div>
          <div className="commandEntry">
            <code>&gt;</code>
            <input
              aria-label="Dummy ASCII 命令"
              value={command}
              onChange={(event) => { setCommand(event.currentTarget.value); setDirectResult(null); }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !sendDisabledReason) void sendDirect(); }}
              spellCheck={false}
            />
            <button type="button" disabled={Boolean(sendDisabledReason)} title={sendDisabledReason ?? '发送到当前 Dummy 会话'} onClick={() => void sendDirect()}><Send size={15} />{sending ? '发送中' : '发送'}</button>
          </div>
          <div className={`validationLine ${validation.valid ? `risk-${validation.risk}` : 'invalid'}`}>
            <span className="statusDot" />
            <strong>{validation.valid ? `${validation.kind} · FORMAT VALID` : 'INVALID'}</strong>
            <span>{sendDisabledReason ?? validation.message}</span>
            <small>{gateway.capabilities.rawCommand ? '实际 TX/RX 只来自 C# 网关' : '离线校验不会写入 TX/RX'}</small>
          </div>
          {directResult && <div className={`directCommandResult status-${directResult.status}`} role="status"><strong>{directResult.status.toUpperCase()}</strong><span>{directResult.message}</span>{directResult.deviceReply && <code>{directResult.deviceReply}</code>}</div>}
        </div>
      </section>

      <aside className="terminalSide panelSurface">
        <div className="sideSection">
          <div className="sideSectionTitle"><Filter size={14} /><span><strong>快捷命令</strong><small>CANONICAL README · 5b9b602d</small></span></div>
          <div className="quickCommands">
            {quickCommands.map((item) => <button type="button" key={item} onClick={() => setCommand(item)}><code>{item}</code><span>填入</span></button>)}
          </div>
        </div>
        <div className="sideSection expertSection">
          <div className="sideSectionTitle"><ShieldAlert size={14} /><span><strong>直连边界</strong><small>GATEWAY CONTROLLED</small></span></div>
          <p>已移除前端解锁步骤。调试命令由本机 C# 网关统一校验、串行发送并限制超时；HOME、RESET、RGB、电流和多行输入保持拒绝。</p>
        </div>
        <div className="terminalSafety"><ShieldAlert size={16} /><div><strong>{gateway.capabilities.rawCommand ? 'ENGINEERING DIRECT' : 'SERIAL OFFLINE'}</strong><span>关节队列应答不等于实机到位；运动后必须观察实测反馈，物理急停必须可触达。</span></div></div>
      </aside>
    </div>
  );
}

function getDirectSendDisabledReason({ gateway, session, jointState, command, validation, sending }: {
  gateway: RobotGatewayV1;
  session: ReturnType<typeof useGatewayRuntimeStore.getState>['session'];
  jointState: ReturnType<typeof useGatewayRuntimeStore.getState>['jointState'];
  command: string;
  validation: ReturnType<typeof validateDummyCommand>;
  sending: boolean;
}) {
  if (sending) return '已有直连命令正在发送';
  if (!validation.valid) return validation.message;
  const line = command.trim();
  if (line === '!HOME' || line === '!RESET') return 'HOME/RESET 会阻塞当前固件命令线程，调试版保持拒绝';
  if (!gateway.capabilities.rawCommand || gateway.capabilities.commandPolicy !== 'engineering') return '请启动 engineering 本机网关后发送';
  if (session.connectionState !== 'connected' || session.profileId !== 'dummy-6dof') return '请先连接 Dummy 串口';
  const isQuery = line.startsWith('#GET');
  const isRelease = line === '!STOP' || line === '!DISABLE';
  const hasMeasuredJointFrame = jointState.profileId === 'dummy-6dof'
    && jointState.source === 'measured'
    && jointState.positionsDeg.length === 6;
  const isManualJointFollowUp = validation.kind === 'JOINT GROUP'
    && session.motorState === 'enabled'
    && session.controlMode !== null
    && hasMeasuredJointFrame;
  if (!isQuery && !isRelease && !isManualJointFollowUp && session.validity !== 'valid') return '需要新鲜有效的设备反馈';
  if (validation.kind === 'MODE' && session.motorState !== 'disabled') return '切换模式前必须先去使能';
  if (validation.kind === 'JOINT GROUP') {
    if (line.slice(1).split(',').length !== 7) return '整组命令必须显式提供第 7 个速度参数';
    if (session.motorState !== 'enabled') return '电机使能后才能发送关节目标';
    if (session.controlMode === null) return '取得有效控制模式后才能发送关节目标';
    if (!hasMeasuredJointFrame) return '当前 Dummy 会话尚未取得六轴实测反馈';
  }
  return null;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 23)}`;
}

function getCaptureState(
  gatewayConfigured: boolean,
  connectionState: ConnectionState,
  validity: Validity,
  frameCount: number
): { label: string; detail: string; source: DataSource; tone: 'ok' | 'warning' | 'muted' | 'danger' } {
  if (!gatewayConfigured) return {
    label: 'STATIC PROTOCOL CAPTURE',
    detail: '以下 TX/RX 为历史展示样例，不代表当前设备通信',
    source: 'showcase',
    tone: 'warning'
  };
  if (connectionState === 'reconnecting' || connectionState === 'faulted' || validity === 'stale') return {
    label: 'SESSION FRAMES · STALE',
    detail: '实时通道不可用；仅保留当前会话已接收的证据',
    source: frameCount ? 'measured' : 'unavailable',
    tone: 'danger'
  };
  if (connectionState === 'connected') return {
    label: frameCount ? 'SESSION PROTOCOL FRAMES' : 'SESSION FRAMES · WAITING',
    detail: frameCount ? '来自当前本机网关会话；原始发送仍不可用' : '已连接，等待真实协议帧',
    source: frameCount ? 'measured' : 'unavailable',
    tone: frameCount ? 'ok' : 'warning'
  };
  return {
    label: 'GATEWAY BUFFER · IDLE',
    detail: `会话状态 ${connectionState.toUpperCase()}；未使用展示记录回填`,
    source: frameCount ? 'measured' : 'unavailable',
    tone: 'muted'
  };
}
