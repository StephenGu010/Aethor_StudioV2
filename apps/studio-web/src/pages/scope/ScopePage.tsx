import { Download, Eye, EyeOff, RadioTower, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignalChart } from '../../components/charts/SignalChart';
import { SourceTag } from '../../components/ui/SourceTag';
import { showcaseSignalSeries } from '../../fixtures/showcase';

const defaultSignals = ['j1.actual.position', 'j1.target.position', 'j2.actual.position'];

export function ScopePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedIds = useMemo(() => {
    const ids = searchParams.get('signals')?.split(',').filter(Boolean);
    return ids?.length ? ids : defaultSignals;
  }, [searchParams]);
  const selectedSeries = useMemo(
    () => showcaseSignalSeries.filter((item) => selectedIds.includes(item.descriptor.signalId)),
    [selectedIds]
  );

  const toggleSignal = (signalId: string) => {
    const next = selectedIds.includes(signalId)
      ? selectedIds.filter((id) => id !== signalId)
      : [...selectedIds, signalId];
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('signals', next.join(','));
    setSearchParams(nextParams, { replace: true });
  };

  const exportCsv = () => {
    const rows = ['timestamp_utc,signal_id,display_name,source,unit,value,validity'];
    selectedSeries.forEach((item) => item.samples.forEach((sample) => {
      rows.push([
        sample.timestampUtc,
        item.descriptor.signalId,
        quoteCsv(item.descriptor.displayName),
        item.descriptor.source.toUpperCase(),
        item.descriptor.unit,
        sample.value ?? '',
        sample.validity.toUpperCase()
      ].join(','));
    }));
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aethor-showcase-signals-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="workspacePage scopePage">
      <aside className="scopeRail panelSurface">
        <div className="railHeading">
          <div><span>SIGNAL CATALOG</span><strong>信号目录</strong></div>
          <button type="button" onClick={() => setSearchParams({}, { replace: true })} aria-label="恢复默认信号"><RotateCcw size={14} /></button>
        </div>
        {[1, 2, 3, 4, 5, 6].map((joint) => (
          <section className="signalGroup" key={joint}>
            <h3>JOINT {joint}</h3>
            {showcaseSignalSeries.filter((item) => item.descriptor.jointId === `j${joint}`).map((item) => {
              const selected = selectedIds.includes(item.descriptor.signalId);
              return (
                <button className={selected ? 'signalItem selected' : 'signalItem'} key={item.descriptor.signalId} type="button" onClick={() => toggleSignal(item.descriptor.signalId)}>
                  {selected ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span className="signalSwatch" style={{ background: item.descriptor.color }} />
                  <span><strong>{item.descriptor.displayName.replace(`J${joint} `, '')}</strong><small>{item.descriptor.source.toUpperCase()} · {item.descriptor.unit}</small></span>
                </button>
              );
            })}
          </section>
        ))}
      </aside>

      <section className="scopeMain panelSurface">
        <div className="workspaceToolbar">
          <div className="liveUnavailable"><span className="statusDot muted" /><strong>LIVE UNAVAILABLE</strong><span>有限展示采集 · 30 s</span></div>
          <div className="toolbarCluster">
            <label>WINDOW <select defaultValue="30" aria-label="示波窗口长度"><option value="30">30 s</option><option value="60" disabled>60 s · LIVE ONLY</option><option value="120" disabled>120 s · LIVE ONLY</option></select></label>
            <button type="button" onClick={exportCsv} disabled={!selectedSeries.length}><Download size={14} /> 导出 CSV</button>
          </div>
        </div>
        <div className="chartSurface">
          {selectedSeries.length ? <SignalChart series={selectedSeries} /> : <div className="emptyState">请选择至少一个信号</div>}
        </div>
        <div className="scopeStats">
          <Metric label="CAPTURE" value="30.0 s" detail="STATIC BUFFER" />
          <Metric label="SAMPLE RATE" value="20 Hz" detail="SHOWCASE" />
          <Metric label="SIGNALS" value={`${selectedSeries.length} / 18`} detail="VISIBLE" />
          <Metric label="SAMPLES" value={selectedSeries.length ? `${selectedSeries[0]?.samples.length ?? 0}` : '0'} detail="PER SIGNAL" />
          <div className="scopeSource"><RadioTower size={16} /><span><strong>来源声明</strong><small>展示采集并非实时测量</small></span><SourceTag source="showcase" /></div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="scopeMetric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
