import * as Dialog from '@radix-ui/react-dialog';
import { Check, Clipboard, Download, Filter, LockKeyhole, Search, Send, ShieldAlert, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SourceTag } from '../../components/ui/SourceTag';
import type { ProtocolFrame } from '../../contracts/types';
import { validateDummyCommand } from '../../domain/dummyCommand';
import { showcaseProtocolFrames } from '../../fixtures/showcase';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';

type DirectionFilter = 'all' | ProtocolFrame['direction'];
const quickCommands = ['#GETJPOS', '#GETMODE', '#GETENABLE', '#CMDMODE 1', '#CMDMODE 2', '!START', '!STOP', '!DISABLE', '!HOME', '!RESET'];

export function TerminalPage() {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [cleared, setCleared] = useState(false);
  const [command, setCommand] = useState('#GETJPOS');
  const [unlockText, setUnlockText] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(false);
  const expertUnlocked = useRobotSessionStore((state) => state.terminalExpertUnlocked);
  const setExpertUnlocked = useRobotSessionStore((state) => state.setTerminalExpertUnlocked);
  const validation = validateDummyCommand(command);
  const visibleFrames = useMemo(() => {
    if (cleared) return [];
    const needle = query.trim().toLowerCase();
    return showcaseProtocolFrames.filter((frame) =>
      (direction === 'all' || frame.direction === direction)
      && (!needle || `${frame.raw} ${frame.parsedKind}`.toLowerCase().includes(needle))
    );
  }, [cleared, direction, query]);

  const exportLog = () => {
    const text = visibleFrames.map((frame) => `${frame.timestampUtc}\t${frame.direction.toUpperCase()}\t${frame.raw}\t${frame.parsedKind}\tSHOWCASE`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'aethor-terminal-showcase.txt';
    anchor.click();
    URL.revokeObjectURL(url);
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
          <button type="button" onClick={() => void navigator.clipboard?.writeText(visibleFrames.map((frame) => frame.raw).join('\n'))} disabled={!visibleFrames.length}><Clipboard size={14} />复制</button>
          <button type="button" onClick={exportLog} disabled={!visibleFrames.length}><Download size={14} />导出</button>
          <button type="button" onClick={() => setCleared(true)} disabled={!visibleFrames.length}><Trash2 size={14} />清空视图</button>
        </div>

        <div className="terminalCaptureBanner">
          <div><span className="statusDot warning" /><strong>STATIC PROTOCOL CAPTURE</strong><span>以下 TX/RX 为历史展示样例，不代表当前设备通信</span></div>
          <SourceTag source="showcase" />
        </div>
        <div className="terminalLog" aria-live="polite">
          {visibleFrames.length ? visibleFrames.map((frame) => (
            <div className={`protocolRow direction-${frame.direction}`} key={frame.id}>
              <time>{formatTimestamp(frame.timestampUtc)}</time>
              <span className="directionBadge">{frame.direction.toUpperCase()}</span>
              <code>{frame.raw}</code>
              <span className="protocolKind">{frame.parsedKind}</span>
              <SourceTag source={frame.source} />
            </div>
          )) : <div className="emptyState">当前视图没有协议帧。原始展示采集未被修改。</div>}
        </div>

        <div className="commandComposer">
          <div className="commandComposerHeader">
            <div><strong>离线格式校验</strong><span>DUMMY ASCII V1 · LOCAL ONLY</span></div>
            {expertUnlocked ? <span className="expertState unlocked"><Check size={13} /> EXPERT UNLOCKED</span> : <span className="expertState"><LockKeyhole size={13} /> READ ONLY</span>}
          </div>
          <div className="commandEntry">
            <code>&gt;</code>
            <input aria-label="Dummy ASCII 命令" value={command} onChange={(event) => setCommand(event.currentTarget.value)} spellCheck={false} />
            <button type="button" disabled title="C# 串口服务未连接"><Send size={15} />真实发送</button>
          </div>
          <div className={`validationLine ${validation.valid ? `risk-${validation.risk}` : 'invalid'}`}>
            <span className="statusDot" />
            <strong>{validation.valid ? `${validation.kind} · FORMAT VALID` : 'INVALID'}</strong>
            <span>{validation.message}</span>
            <small>未写入 TX/RX 记录</small>
          </div>
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
          <div className="sideSectionTitle"><ShieldAlert size={14} /><span><strong>专家会话</strong><small>SESSION SCOPED</small></span></div>
          <p>解锁只影响当前前端会话，不会绕过后端权限、安全互锁或危险操作确认。</p>
          {expertUnlocked ? (
            <button className="secondaryButton" type="button" onClick={() => setExpertUnlocked(false)}><LockKeyhole size={14} />重新锁定</button>
          ) : (
            <Dialog.Root open={unlockOpen} onOpenChange={setUnlockOpen}>
              <Dialog.Trigger asChild><button className="secondaryButton" type="button"><LockKeyhole size={14} />解锁专家输入</button></Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialogOverlay" />
                <Dialog.Content className="dialogContent">
                  <div className="dialogTitleRow"><Dialog.Title>解锁专家输入</Dialog.Title><Dialog.Close aria-label="关闭"><X size={15} /></Dialog.Close></div>
                  <Dialog.Description>仅开放命令格式编辑；离线状态仍不可发送。切换设备或重启应用后自动失效。</Dialog.Description>
                  <label className="unlockField"><span>输入 <code>UNLOCK</code> 以确认</span><input autoFocus value={unlockText} onChange={(event) => setUnlockText(event.currentTarget.value)} /></label>
                  <div className="dialogActions"><Dialog.Close asChild><button type="button">取消</button></Dialog.Close><button className="primaryButton" type="button" disabled={unlockText !== 'UNLOCK'} onClick={() => { setExpertUnlocked(true); setUnlockOpen(false); setUnlockText(''); }}>确认解锁</button></div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )}
        </div>
        <div className="terminalSafety"><ShieldAlert size={16} /><div><strong>SERIAL OFFLINE</strong><span>软件急停无法替代物理急停；当前没有任何命令可达硬件。</span></div></div>
      </aside>
    </div>
  );
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 23)}`;
}
