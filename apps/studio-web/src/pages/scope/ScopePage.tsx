import { Download, Eye, EyeOff, RadioTower, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DataSource, SignalDescriptor, SignalSeries } from '@aethor/contracts';
import { SignalChart } from '../../components/charts/SignalChart';
import { SourceTag } from '../../components/ui/SourceTag';
import { buildSignalCsv } from '../../domain/signalCsv';
import {
  TELEMETRY_DEFAULT_WINDOW_SECONDS,
  TELEMETRY_MAX_WINDOW_SECONDS
} from '../../domain/LiveSignalHistory';
import { showcaseSignalSeries } from '../../fixtures/showcase';
import { useTelemetryHistorySnapshot } from '../../hooks/useTelemetryHistorySnapshot';
import { robotGateway } from '../../integrations/gatewayInstance';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { getLiveSignalCatalog } from '../../stores/useTelemetryHistoryStore';

const defaultSignals = ['j1.actual.position', 'j1.target.position', 'j2.actual.position'];
const showcaseWindowSeconds = 30;

export function ScopePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const gatewayConfigured = robotGateway.capabilities.readOnlyConnection;
  const session = useGatewayRuntimeStore((state) => state.session);
  const jointState = useGatewayRuntimeStore((state) => state.jointState);
  const transportWarning = useGatewayRuntimeStore((state) => state.transportWarning);
  const catalog = useMemo<SignalDescriptor[]>(
    () => gatewayConfigured
      ? getLiveSignalCatalog()
      : showcaseSignalSeries.map((item) => item.descriptor),
    [gatewayConfigured]
  );
  const catalogIds = useMemo(() => new Set(catalog.map((item) => item.signalId)), [catalog]);
  const selectedIds = useMemo(() => {
    const requested = searchParams.get('signals')?.split(',').filter((id) => catalogIds.has(id));
    return searchParams.has('signals') ? (requested ?? []) : defaultSignals;
  }, [catalogIds, searchParams]);
  const requestedWindow = Number(searchParams.get('window'));
  const windowSeconds = gatewayConfigured && [30, 60, TELEMETRY_MAX_WINDOW_SECONDS].includes(requestedWindow)
    ? requestedWindow
    : gatewayConfigured ? TELEMETRY_DEFAULT_WINDOW_SECONDS : showcaseWindowSeconds;
  const liveSnapshot = useTelemetryHistorySnapshot(selectedIds, windowSeconds);
  const selectedSeries = useMemo<SignalSeries[]>(
    () => gatewayConfigured
      ? liveSnapshot.series
      : showcaseSignalSeries.filter((item) => selectedIds.includes(item.descriptor.signalId)),
    [gatewayConfigured, liveSnapshot.series, selectedIds]
  );
  const liveState = getLiveState(gatewayConfigured, session, jointState.validity, transportWarning, liveSnapshot.acceptedFrameCount);

  const updateParam = (key: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set(key, value);
    setSearchParams(nextParams, { replace: true });
  };
  const toggleSignal = (signalId: string) => {
    const next = selectedIds.includes(signalId)
      ? selectedIds.filter((id) => id !== signalId)
      : [...selectedIds, signalId];
    updateParam('signals', next.join(','));
  };
  const resetView = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('signals');
    nextParams.delete('window');
    setSearchParams(nextParams, { replace: true });
  };
  const exportCsv = () => {
    const csv = buildSignalCsv(selectedSeries, {
      sessionId: gatewayConfigured ? (liveSnapshot.sessionId ?? session.sessionId) : 'showcase-offline',
      profileId: gatewayConfigured ? (liveSnapshot.profileId ?? session.profileId) : 'dummy-6dof'
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aethor-${gatewayConfigured ? 'live' : 'showcase'}-signals-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="workspacePage scopePage">
      <aside className="scopeRail panelSurface">
        <div className="railHeading">
          <div><span>SIGNAL CATALOG</span><strong>信号目录</strong></div>
          <button type="button" onClick={resetView} aria-label="恢复默认信号"><RotateCcw size={14} /></button>
        </div>
        {[1, 2, 3, 4, 5, 6].map((joint) => (
          <section className="signalGroup" key={joint}>
            <h3>JOINT {joint}</h3>
            {catalog.filter((item) => item.jointId === `j${joint}`).map((item) => {
              const selected = selectedIds.includes(item.signalId);
              return (
                <button className={selected ? 'signalItem selected' : 'signalItem'} key={item.signalId} type="button" onClick={() => toggleSignal(item.signalId)}>
                  {selected ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span className="signalSwatch" style={{ background: item.color }} />
                  <span><strong>{item.displayName.replace(`J${joint} `, '')}</strong><small>{item.source.toUpperCase()} · {item.unit}</small></span>
                </button>
              );
            })}
          </section>
        ))}
      </aside>

      <section className="scopeMain panelSurface">
        <div className="workspaceToolbar">
          <div className={`liveUnavailable liveState-${liveState.tone}`}>
            <span className={`statusDot ${liveState.tone}`} />
            <strong>{liveState.label}</strong>
            <span>{liveState.detail}</span>
          </div>
          <div className="toolbarCluster">
            <label>WINDOW <select value={windowSeconds} aria-label="示波窗口长度" onChange={(event) => updateParam('window', event.currentTarget.value)}>
              <option value="30">30 s</option>
              <option value="60" disabled={!gatewayConfigured}>60 s{gatewayConfigured ? '' : ' · LIVE ONLY'}</option>
              <option value="120" disabled={!gatewayConfigured}>120 s{gatewayConfigured ? '' : ' · LIVE ONLY'}</option>
            </select></label>
            <button type="button" onClick={exportCsv} disabled={!hasSamples(selectedSeries)}><Download size={14} /> 导出 CSV</button>
          </div>
        </div>
        <div className="chartSurface">
          {selectedSeries.length
            ? hasSamples(selectedSeries)
              ? <SignalChart series={selectedSeries} />
              : <div className="emptyState">{gatewayConfigured ? '实时缓冲区暂无可信遥测帧' : '展示采集不可用'}</div>
            : <div className="emptyState">请选择至少一个信号</div>}
        </div>
        <div className="scopeStats">
          <Metric label="CAPTURE" value={gatewayConfigured ? `${liveSnapshot.captureDurationSeconds.toFixed(1)} s` : '30.0 s'} detail={gatewayConfigured ? `WINDOW ${windowSeconds} s` : 'STATIC BUFFER'} />
          <Metric label="SAMPLE RATE" value={gatewayConfigured ? formatRate(liveSnapshot.estimatedSampleRateHz) : '20 Hz'} detail={gatewayConfigured ? 'MEASURED' : 'SHOWCASE'} />
          <Metric label="SIGNALS" value={`${selectedSeries.length} / ${catalog.length}`} detail="VISIBLE" />
          <Metric label="SAMPLES" value={gatewayConfigured ? `${liveSnapshot.retainedSamplesPerSignal}` : `${selectedSeries[0]?.samples.length ?? 0}`} detail="PER SIGNAL" />
          <Metric label="DROPS" value={gatewayConfigured ? `${liveSnapshot.detectedDroppedFrameCount}` : '—'} detail={gatewayConfigured ? 'SEQUENCE GAPS' : 'NOT MEASURED'} />
          <div className="scopeSource"><RadioTower size={16} /><span><strong>来源声明</strong><small>{liveState.provenance}</small></span><SourceTag source={liveState.source} /></div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="scopeMetric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function hasSamples(series: readonly SignalSeries[]) {
  return series.some((item) => item.samples.length > 0);
}

function formatRate(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)} Hz`;
}

function getLiveState(
  gatewayConfigured: boolean,
  session: ReturnType<typeof useGatewayRuntimeStore.getState>['session'],
  jointValidity: ReturnType<typeof useGatewayRuntimeStore.getState>['jointState']['validity'],
  transportWarning: string | null,
  acceptedFrameCount: number
): { label: string; detail: string; provenance: string; source: DataSource; tone: 'ok' | 'warning' | 'muted' | 'danger' } {
  if (!gatewayConfigured) return {
    label: 'LIVE UNAVAILABLE', detail: '有限展示采集 · 30 s', provenance: '展示采集并非实时测量', source: 'showcase', tone: 'muted'
  };
  if (transportWarning || session.connectionState === 'reconnecting' || session.connectionState === 'faulted' || jointValidity === 'stale') return {
    label: 'LIVE STALE', detail: transportWarning ?? '遥测正在恢复；保留最近可信历史', provenance: '历史数据保留，当前值不可作为实时反馈', source: acceptedFrameCount ? 'measured' : 'unavailable', tone: 'danger'
  };
  if (session.connectionState === 'connected' && acceptedFrameCount > 0) return {
    label: 'LIVE MEASURED', detail: '可信网关遥测正在采集', provenance: '来自当前本机网关会话', source: 'measured', tone: 'ok'
  };
  if (session.connectionState === 'connected') return {
    label: 'LIVE WAITING', detail: '已连接，等待首个可信关节帧', provenance: '尚无可导出的测量样本', source: 'unavailable', tone: 'warning'
  };
  return {
    label: 'GATEWAY IDLE', detail: `会话状态 · ${session.connectionState.toUpperCase()}`, provenance: '网关已配置，未使用展示数据回填', source: 'unavailable', tone: 'muted'
  };
}
