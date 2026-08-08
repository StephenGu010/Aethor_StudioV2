import type { JointStateFrame, RobotSessionSnapshot, SerialPortDescriptor } from '@aethor/contracts';
import { Archive, CheckCircle2, CircleAlert, Cpu, FileCheck2, HardDrive, Link2Off, PackageCheck, RefreshCw, ShieldCheck, Upload, Waypoints } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Hint } from '../../components/ui/Hint';
import { SourceTag } from '../../components/ui/SourceTag';
import type { ProfilePackageValidation } from '../../domain/profilePackage';
import { validateProfilePackage } from '../../domain/profilePackage';
import { showcaseSession } from '../../fixtures/showcase';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { dummyProfile } from '../../profile/dummyProfile';

export function DeviceModelPage({ gateway = robotGateway }: { gateway?: RobotGatewayV1 }) {
  const [packageResult, setPackageResult] = useState<ProfilePackageValidation | null>(null);
  const [packageName, setPackageName] = useState('');
  const [validating, setValidating] = useState(false);
  const [ports, setPorts] = useState<SerialPortDescriptor[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [session, setSession] = useState<RobotSessionSnapshot>(showcaseSession);
  const [jointState, setJointState] = useState<JointStateFrame | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [telemetryWarning, setTelemetryWarning] = useState<string | null>(null);
  const gatewayAvailable = gateway.capabilities.readOnlyConnection;
  const sessionActive = ['connecting', 'connected', 'reconnecting', 'disconnecting'].includes(session.connectionState);

  useEffect(() => {
    if (!gatewayAvailable) return;
    let mounted = true;
    let closeTelemetry: (() => Promise<void>) | undefined;
    const load = async () => {
      try {
        const [nextPorts, nextSession, nextJointState] = await Promise.all([
          gateway.listSerialPorts(),
          gateway.getSession(),
          gateway.getJointState()
        ]);
        if (!mounted) return;
        setPorts(nextPorts);
        setSession(nextSession);
        setJointState(nextJointState);
        setGatewayError(null);
      } catch (error) {
        if (mounted) setGatewayError(error instanceof Error ? error.message : '只读网关不可用');
        return;
      }

      try {
        const close = await gateway.openTelemetry({
          onSession: (value) => mounted && setSession(value),
          onJointState: (value) => mounted && setJointState(value),
          onTransportError: (message) => mounted && setTelemetryWarning(message)
        });
        if (mounted) closeTelemetry = close;
        else await close();
      } catch (error) {
        if (mounted) setTelemetryWarning(error instanceof Error ? error.message : '实时遥测不可用；可继续手动刷新 REST 快照');
      }
    };
    void load();
    return () => {
      mounted = false;
      if (closeTelemetry) void closeTelemetry();
    };
  }, [gateway, gatewayAvailable]);

  const inspectPackage = async (file: File | undefined) => {
    if (!file) return;
    setPackageName(file.name);
    setValidating(true);
    try {
      setPackageResult(await validateProfilePackage(file));
    } finally {
      setValidating(false);
    }
  };

  const refreshGateway = async () => {
    if (!gatewayAvailable || gatewayBusy) return;
    setGatewayBusy(true);
    setGatewayError(null);
    try {
      const [nextPorts, nextSession, nextJointState] = await Promise.all([
        gateway.listSerialPorts(), gateway.getSession(), gateway.getJointState()
      ]);
      setPorts(nextPorts);
      setSession(nextSession);
      setJointState(nextJointState);
      if (selectedPort && !nextPorts.some((port) => port.portName === selectedPort)) setSelectedPort('');
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : '刷新只读网关失败');
    } finally {
      setGatewayBusy(false);
    }
  };

  const connectReadOnly = async () => {
    if (!gatewayAvailable || !selectedPort || gatewayBusy || sessionActive) return;
    setGatewayBusy(true);
    setGatewayError(null);
    try {
      setSession(await gateway.connectReadOnly({ portName: selectedPort, profileId: 'dummy-6dof' }));
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : '只读串口连接失败');
    } finally {
      setGatewayBusy(false);
    }
  };

  const disconnectGateway = async () => {
    if (!gatewayAvailable || gatewayBusy || !sessionActive) return;
    setGatewayBusy(true);
    setGatewayError(null);
    try {
      setSession(await gateway.disconnect());
      setJointState(await gateway.getJointState());
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : '断开只读串口失败');
    } finally {
      setGatewayBusy(false);
    }
  };

  return (
    <div className="workspacePage devicesPage">
      <section className="deviceOverview panelSurface">
        <div className="sectionLead">
          <div className="profileMonogram">D6</div>
          <div><span>ACTIVE BUILT-IN PROFILE</span><h2>{dummyProfile.displayName}</h2><p>{dummyProfile.profileId} · {dummyProfile.model.dof}-DOF MANIPULATOR</p></div>
          <div className="sectionLeadStatus"><span className="statusDot ok" /><strong>PROFILE VALID</strong><SourceTag source="showcase" /></div>
        </div>
        <div className="overviewGrid">
          <InfoCard icon={<Waypoints />} label="MODEL" value="dummy.urdf" detail="Z-UP · METERS" />
          <InfoCard icon={<Cpu />} label="PROTOCOL" value={dummyProfile.protocolAdapterId} detail="ASCII · LF" />
          <InfoCard icon={<HardDrive />} label="TRANSPORT" value={gatewayAvailable ? `${ports.length} PORT${ports.length === 1 ? '' : 'S'}` : '115200 baud'} detail={session.connectionState.toUpperCase()} warning={session.connectionState !== 'connected'} />
          <InfoCard icon={<ShieldCheck />} label="LICENSE" value={dummyProfile.source.license} detail="SOURCE RECORDED" />
        </div>
      </section>

      <section className="deviceControls panelSurface">
        <div className="cardHeading"><div><span>READ-ONLY HARDWARE SESSION</span><h2>设备连接与状态</h2></div><div className={`offlinePill gateway-${session.connectionState}`}><Link2Off size={13} /> {gatewayAvailable ? session.connectionState.toUpperCase() : 'BACKEND ABSENT'}</div></div>
        <div className={gatewayError ? 'hardwareNotice gatewayError' : 'hardwareNotice'}><CircleAlert size={16} /><span>{gatewayError ?? (gatewayAvailable ? 'Phase 4 只允许 #GETJPOS / #GETMODE / #GETENABLE；选择端口后仍需手动连接。' : `${gateway.unavailableReason ?? '只读网关未配置'}；静态数据不会提升为在线状态。`)}</span></div>
        <div className="serialConnectRow">
          <label><span>SERIAL PORT</span><select aria-label="串口" value={selectedPort} disabled={!gatewayAvailable || gatewayBusy || sessionActive} onChange={(event) => setSelectedPort(event.currentTarget.value)}><option value="">手动选择端口</option>{ports.map((port) => <option key={port.portName} value={port.portName}>{port.displayName ?? port.portName}</option>)}</select></label>
          <button className="gatewayOperation primaryReadOnly" type="button" disabled={!gatewayAvailable || !selectedPort || gatewayBusy || sessionActive} onClick={() => void connectReadOnly()}><strong>只读连接</strong><small>CONNECT + QUERY ONLY</small></button>
          <button className="gatewayOperation" type="button" disabled={!gatewayAvailable || gatewayBusy || !sessionActive} onClick={() => void disconnectGateway()}><strong>断开连接</strong><small>RELEASE SERIAL</small></button>
          <button className="gatewayOperation" type="button" disabled={!gatewayAvailable || gatewayBusy} onClick={() => void refreshGateway()}><RefreshCw size={13} /><strong>刷新状态</strong><small>REST SNAPSHOT</small></button>
        </div>
        <div className="gatewaySessionGrid">
          <StatusDatum label="CONNECTION" value={session.connectionState.toUpperCase()} tone={session.connectionState === 'connected' ? 'ok' : session.connectionState === 'faulted' ? 'error' : 'warning'} />
          <StatusDatum label="VALIDITY" value={session.validity.toUpperCase()} tone={session.validity === 'valid' ? 'ok' : session.validity === 'invalid' ? 'error' : 'warning'} />
          <StatusDatum label="MOTOR" value={session.motorState.toUpperCase()} tone={session.motorState === 'enabled' ? 'warning' : session.motorState === 'disabled' ? 'ok' : 'neutral'} />
          <StatusDatum label="MODE" value={session.controlMode === null ? 'UNKNOWN' : String(session.controlMode)} tone="neutral" />
          <StatusDatum label="SOURCE" value={session.source.toUpperCase()} tone={session.source === 'measured' ? 'ok' : 'neutral'} />
          <StatusDatum label="FEEDBACK (J1–J6 DEG)" value={jointState?.validity === 'valid' ? jointState.positionsDeg.map((value) => value.toFixed(1)).join(' / ') : 'UNAVAILABLE'} tone={jointState?.validity === 'valid' ? 'ok' : 'neutral'} wide />
        </div>
        {telemetryWarning && <div className="telemetryWarning"><CircleAlert size={13} />{telemetryWarning}</div>}
        <div className="operationGrid phaseFiveOperations">
          <DisabledOperation label="使能设备" meta="PHASE 5 · NOT AVAILABLE" />
          <DisabledOperation label="停止并去使能" meta="PHASE 5 · NOT AVAILABLE" danger />
          <DisabledOperation label="回零" meta="PHASE 5 · SAFETY UNKNOWN" danger />
          <DisabledOperation label="复位" meta="PHASE 5 · NOT AVAILABLE" />
        </div>
        <div className="modeControl">
          <div><strong>控制模式</strong><span>#CMDMODE 1–3 · PHASE 5</span></div>
          {dummyProfile.capabilities.controlModes.map((mode) => (
            <Hint content="Phase 4 严格只读；模式切换属于 Phase 5" key={mode}>
              <button type="button" disabled><span>MODE</span><strong>{mode}</strong></button>
            </Hint>
          ))}
        </div>
      </section>

      <section className="jointMapping panelSurface">
        <div className="cardHeading"><div><span>URDF / PROTOCOL MAPPING</span><h2>关节映射与限位</h2></div><span className="verifiedLabel"><FileCheck2 size={14} /> 6 / 6 MAPPED</span></div>
        <table className="dataTable jointProfileTable">
          <thead><tr><th>INDEX</th><th>PROFILE ID</th><th>URDF JOINT</th><th>LOWER</th><th>UPPER</th><th>EFFORT</th><th>VELOCITY</th></tr></thead>
          <tbody>{dummyProfile.joints.map((joint) => <tr key={joint.jointId}><td>{joint.protocolIndex}</td><th>{joint.displayName}</th><td><code>{joint.urdfJointName}</code></td><td>{joint.lowerDeg.toFixed(2)}°</td><td>{joint.upperDeg.toFixed(2)}°</td><td><span className="unknownValue">UNVERIFIED</span></td><td><span className="unknownValue">UNVERIFIED</span></td></tr>)}</tbody>
        </table>
        <div className="mappingFootnote"><CircleAlert size={14} /> 原 URDF 的 effort / velocity 为 0，不能解释为可信硬件上限；展示位也不是安全回位姿态。</div>
      </section>

      <section className="packageInspector panelSurface">
        <div className="cardHeading"><div><span>MANAGED PROFILE PACKAGE</span><h2>.aethor-robot 校验预览</h2></div><Archive size={18} /></div>
        <p>在浏览器内检查 ZIP 结构、manifest、URDF、关节映射与 mesh 引用。此阶段不会安装或持久化配置包。</p>
        <label className="packageDropzone">
          <input type="file" accept=".aethor-robot,.zip" onChange={(event) => void inspectPackage(event.currentTarget.files?.[0])} />
          <Upload size={22} />
          <span><strong>{validating ? '正在验证…' : '选择 .aethor-robot 配置包'}</strong><small>MAX UNPACKED 250 MiB · LOCAL PREVIEW ONLY</small></span>
        </label>
        {packageResult && (
          <div className={packageResult.valid ? 'packageResult valid' : 'packageResult invalid'}>
            <div>{packageResult.valid ? <PackageCheck size={18} /> : <CircleAlert size={18} />}<span><strong>{packageResult.valid ? 'PACKAGE VALID FOR PREVIEW' : 'PACKAGE REJECTED'}</strong><small>{packageName} · {packageResult.fileCount} files · {formatBytes(packageResult.unpackedBytes)}</small></span></div>
            {packageResult.profile && <dl><div><dt>PROFILE</dt><dd>{packageResult.profile.profileId}</dd></div><div><dt>DOF</dt><dd>{packageResult.profile.model.dof}</dd></div><div><dt>URDF</dt><dd>{packageResult.profile.model.urdfPath}</dd></div></dl>}
            {packageResult.errors.length > 0 && <ul>{packageResult.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
          </div>
        )}
        <div className="packageRules">
          {['拒绝路径穿越与外部 URL', '校验缺失 mesh 与重复关节', '校验 DOF、索引、限位与 Schema', '未来由 C# 服务二次验证后安装'].map((rule) => <span key={rule}><CheckCircle2 size={13} />{rule}</span>)}
        </div>
      </section>

      <section className="sourceRecord panelSurface">
        <div className="cardHeading"><div><span>PROVENANCE</span><h2>来源记录</h2></div></div>
        <dl className="sourceDetails">
          <div><dt>ORIGINAL URDF SHA-256</dt><dd><code>{dummyProfile.source.urdfSha256}</code></dd></div>
          <div><dt>PROTOCOL REFERENCE</dt><dd><code>{dummyProfile.source.protocolReference}</code></dd></div>
          <div><dt>NORMALIZED NAMES</dt><dd><code>dummy / base_link / link_1…6 / joint_1…6</code></dd></div>
          <div><dt>PROFILE INSTALLATION</dt><dd><span className="unknownValue">NOT IMPLEMENTED</span></dd></div>
        </dl>
      </section>
    </div>
  );
}

function InfoCard({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="infoCard"><span className={warning ? 'warning' : ''}>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

function StatusDatum({ label, value, tone, wide = false }: { label: string; value: string; tone: 'ok' | 'warning' | 'error' | 'neutral'; wide?: boolean }) {
  return <div className={wide ? `gatewayDatum ${tone} wide` : `gatewayDatum ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function DisabledOperation({ label, meta, danger = false }: { label: string; meta: string; danger?: boolean }) {
  return (
    <Hint content="Phase 4 严格只读；该硬件操作属于 Phase 5">
      <button className={danger ? 'disabledOperation danger' : 'disabledOperation'} type="button" disabled>
        <span><strong>{label}</strong><small>{meta}</small></span>
      </button>
    </Hint>
  );
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}
