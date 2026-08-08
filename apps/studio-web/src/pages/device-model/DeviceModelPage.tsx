import { Archive, CheckCircle2, CircleAlert, Cpu, FileCheck2, HardDrive, Info, Link2Off, PackageCheck, RefreshCw, ShieldCheck, Upload, Waypoints } from 'lucide-react';
import { useState } from 'react';
import { SourceTag } from '../../components/ui/SourceTag';
import type { ProfilePackageValidation } from '../../domain/profilePackage';
import { validateProfilePackage } from '../../domain/profilePackage';
import { dummyProfile } from '../../profile/dummyProfile';

export function DeviceModelPage() {
  const [packageResult, setPackageResult] = useState<ProfilePackageValidation | null>(null);
  const [packageName, setPackageName] = useState('');
  const [validating, setValidating] = useState(false);

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
          <InfoCard icon={<HardDrive />} label="TRANSPORT" value="115200 baud" detail="SERIAL OFFLINE" warning />
          <InfoCard icon={<ShieldCheck />} label="LICENSE" value={dummyProfile.source.license} detail="SOURCE RECORDED" />
        </div>
      </section>

      <section className="deviceControls panelSurface">
        <div className="cardHeading"><div><span>HARDWARE OPERATIONS</span><h2>设备控制</h2></div><div className="offlinePill"><Link2Off size={13} /> BACKEND ABSENT</div></div>
        <div className="hardwareNotice"><CircleAlert size={16} /><span>真实硬件动作由未来 C# 服务独占。当前所有操作均禁用，且不会模拟成功结果。</span></div>
        <div className="operationGrid">
          <DisabledOperation label="连接串口" meta="CONNECT" />
          <DisabledOperation label="断开连接" meta="DISCONNECT" />
          <DisabledOperation label="刷新状态" meta="REFRESH" icon={<RefreshCw size={14} />} />
          <DisabledOperation label="使能设备" meta="ENABLE" />
          <DisabledOperation label="停止并去使能" meta="STOP → ZERO → DISABLE → VERIFY" danger />
          <DisabledOperation label="回零" meta="HOME · SAFETY UNKNOWN" danger />
          <DisabledOperation label="复位" meta="RESET" />
        </div>
        <div className="modeControl">
          <div><strong>控制模式</strong><span>#CMDMODE 1–3 · PROFILE ALLOWED</span></div>
          {dummyProfile.capabilities.controlModes.map((mode) => <button type="button" disabled key={mode}><span>MODE</span><strong>{mode}</strong></button>)}
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

function DisabledOperation({ label, meta, icon, danger = false }: { label: string; meta: string; icon?: React.ReactNode; danger?: boolean }) {
  return <button className={danger ? 'disabledOperation danger' : 'disabledOperation'} type="button" disabled>{icon}<span><strong>{label}</strong><small>{meta}</small></span></button>;
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}
