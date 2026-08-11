import type { CommandAuditRecord, RobotCommandKind } from '@aethor/contracts';
import { Archive, CheckCircle2, CircleAlert, Cpu, Download, FileCheck2, HardDrive, Link2Off, PackageCheck, RefreshCw, ShieldCheck, Upload, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Hint } from '../../components/ui/Hint';
import { SourceTag } from '../../components/ui/SourceTag';
import type { ProfilePackageValidation } from '../../domain/profilePackage';
import { PROFILE_PACKAGE_LIMITS, validateProfilePackage } from '../../domain/profilePackage';
import { runGatewayCommandLifecycle } from '../../integrations/GatewayCommandLifecycle';
import { desktopBridge, type DesktopBridgeV1 } from '../../integrations/desktopBridge';
import { robotGateway } from '../../integrations/gatewayInstance';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { refreshSerialPortCatalog } from '../../integrations/serialPortCatalog';
import { connectSerialSession, disconnectSerialSession } from '../../integrations/serialSessionOperations';
import { aethorRoboJointGroups, aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';

export function DeviceModelPage({
  gateway = robotGateway,
  bridge = desktopBridge
}: {
  gateway?: RobotGatewayV1;
  bridge?: DesktopBridgeV1;
}) {
  const activeProfileId = useActiveRobotProfileStore((state) => state.activeProfileId);
  return activeProfileId === aethorRoboProfile.profileId
    ? <AethorRoboDeviceModelPage bridge={bridge} />
    : <DummyDeviceModelPage gateway={gateway} bridge={bridge} />;
}

function DummyDeviceModelPage({ gateway, bridge }: { gateway: RobotGatewayV1; bridge: DesktopBridgeV1 }) {
  const [packageResult, setPackageResult] = useState<ProfilePackageValidation | null>(null);
  const [packageName, setPackageName] = useState('');
  const [validating, setValidating] = useState(false);
  const packageValidationController = useRef<AbortController | null>(null);
  const ports = useGatewayRuntimeStore((state) => state.serialPorts);
  const selectedPort = useGatewayRuntimeStore((state) => state.selectedPortName);
  const setSelectedPort = useGatewayRuntimeStore((state) => state.setSelectedPortName);
  const serialPortCatalogStatus = useGatewayRuntimeStore((state) => state.serialPortCatalogStatus);
  const serialPortCatalogError = useGatewayRuntimeStore((state) => state.serialPortCatalogError);
  const serialSessionOperationStatus = useGatewayRuntimeStore((state) => state.serialSessionOperationStatus);
  const serialSessionOperationError = useGatewayRuntimeStore((state) => state.serialSessionOperationError);
  const session = useGatewayRuntimeStore((state) => state.session);
  const setSession = useGatewayRuntimeStore((state) => state.setSession);
  const setActivePortName = useGatewayRuntimeStore((state) => state.setActivePortName);
  const jointState = useGatewayRuntimeStore((state) => state.jointState);
  const setJointState = useGatewayRuntimeStore((state) => state.setJointState);
  const completeDisconnect = useGatewayRuntimeStore((state) => state.completeDisconnect);
  const gatewayCapabilities = useGatewayRuntimeStore((state) => state.capabilities);
  const telemetryWarning = useGatewayRuntimeStore((state) => state.transportWarning);
  const lastCommandResult = useGatewayRuntimeStore((state) => state.lastCommandResult);
  const latchedSafetyResult = useGatewayRuntimeStore((state) => state.latchedSafetyResult);
  const commandHistory = useGatewayRuntimeStore((state) => state.commandHistory);
  const commandAuditStatus = useGatewayRuntimeStore((state) => state.commandAuditStatus);
  const commandAuditError = useGatewayRuntimeStore((state) => state.commandAuditError);
  const beginCommandAuditRefresh = useGatewayRuntimeStore((state) => state.beginCommandAuditRefresh);
  const failCommandAuditRefresh = useGatewayRuntimeStore((state) => state.failCommandAuditRefresh);
  const replaceCommandHistory = useGatewayRuntimeStore((state) => state.replaceCommandHistory);
  const setTransportWarning = useGatewayRuntimeStore((state) => state.setTransportWarning);
  const markTelemetryDegraded = useGatewayRuntimeStore((state) => state.markTelemetryDegraded);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState<RobotCommandKind | null>(null);
  const commandRunSequence = useRef(0);
  const gatewayAvailable = gateway.capabilities.readOnlyConnection;
  const sessionActive = session.connectionState !== 'offline';
  const serialCatalogBusy = serialPortCatalogStatus === 'loading';
  const serialSessionBusy = serialSessionOperationStatus === 'connecting' || serialSessionOperationStatus === 'disconnecting';
  const visibleGatewayError = gatewayError ?? serialSessionOperationError ?? serialPortCatalogError;

  useEffect(() => {
    if (!gatewayAvailable || sessionActive) return;
    void refreshSerialPortCatalog(gateway).catch(() => undefined);
  }, [gateway, gatewayAvailable, sessionActive]);

  useEffect(() => () => packageValidationController.current?.abort(), []);

  const inspectPackage = async (file: File | undefined) => {
    if (!file) return;
    packageValidationController.current?.abort();
    const controller = new AbortController();
    packageValidationController.current = controller;
    setPackageName(file.name);
    setPackageResult(null);
    setValidating(true);
    try {
      const result = await validateProfilePackage(file, controller.signal);
      if (packageValidationController.current === controller && !controller.signal.aborted) setPackageResult(result);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (packageValidationController.current === controller) {
        setPackageResult({
          valid: false,
          profile: null,
          errors: [error instanceof Error ? `配置包校验失败：${error.message}` : '配置包校验失败'],
          fileCount: 0,
          unpackedBytes: 0
        });
      }
    } finally {
      if (packageValidationController.current === controller) {
        packageValidationController.current = null;
        setValidating(false);
      }
    }
  };

  const refreshCommandAudit = async () => {
    if (!gatewayAvailable || commandAuditStatus === 'loading') return;
    beginCommandAuditRefresh();
    try {
      replaceCommandHistory(await gateway.getCommandHistory());
    } catch (error) {
      failCommandAuditRefresh(error instanceof Error ? error.message : '命令审计刷新失败');
    }
  };

  const refreshGateway = async () => {
    if (!gatewayAvailable || gatewayBusy || serialSessionBusy) return;
    setGatewayBusy(true);
    setGatewayError(null);
    const preserveDegradedTelemetry = telemetryWarning !== null
      || session.validity === 'stale'
      || jointState.validity === 'stale';
    try {
      const [nextPorts, nextSession, nextJointState] = await Promise.all([
        refreshSerialPortCatalog(gateway), gateway.getSession(), gateway.getJointState()
      ]);
      setSession(nextSession);
      setJointState(nextJointState);
      if (preserveDegradedTelemetry) {
        markTelemetryDegraded(telemetryWarning ?? '实时遥测尚未恢复；REST 快照仅代表刷新时刻');
      } else {
        setTransportWarning(null);
      }
      if (selectedPort && !nextPorts.some((port) => port.portName === selectedPort)) setSelectedPort('');
      void refreshCommandAudit();
    } catch (error) {
      const message = error instanceof Error ? error.message : '刷新只读网关失败';
      setGatewayError(message);
      markTelemetryDegraded(message);
    } finally {
      setGatewayBusy(false);
    }
  };

  const connectGateway = async () => {
    if (!gatewayAvailable || !selectedPort || gatewayBusy || serialSessionBusy || sessionActive) return;
    setGatewayError(null);
    try {
      const nextSession = await connectSerialSession(gateway, { portName: selectedPort, profileId: 'dummy-6dof' });
      setActivePortName(selectedPort);
      useRobotSessionStore.getState().beginHardwareSession(nextSession.sessionId);
      setSession(nextSession);
    } catch (error) {
      const message = error instanceof Error ? error.message : '只读串口连接失败';
      setGatewayError(message);
      markTelemetryDegraded(`连接请求结果未知：${message}`);
    }
  };

  const disconnectGateway = async () => {
    if (!gatewayAvailable || gatewayBusy || serialSessionBusy || !sessionActive || session.connectionState === 'disconnecting'
      || session.motorState === 'enabled' || commandBusy !== null) return;
    setGatewayError(null);
    try {
      const nextSession = await disconnectSerialSession(gateway);
      let nextJointState: Awaited<ReturnType<RobotGatewayV1['getJointState']>> | undefined;
      try {
        nextJointState = await gateway.getJointState();
      } catch {
        // The session is already offline; completeDisconnect clears stale
        // measured state and restores the software startup pose.
      }
      completeDisconnect(nextSession, nextJointState);
    } catch (error) {
      const message = error instanceof Error ? error.message : '断开只读串口失败';
      setGatewayError(message);
      markTelemetryDegraded(`断开请求结果未知：${message}`);
    }
  };

  const supportsCommand = (kind: RobotCommandKind) =>
    gatewayCapabilities?.hardwareCommands === true
    && gatewayCapabilities.commandPolicy !== 'disabled'
    && gatewayCapabilities.supportedCommands.includes(kind);

  const commandIdentity = () => ({
    commandId: crypto.randomUUID(),
    sessionId: session.sessionId,
    profileId: 'dummy-6dof'
  });

  const runCommand = async (kind: Exclude<RobotCommandKind, 'jointGroup'>, mode?: 1 | 2 | 3) => {
    if (session.connectionState !== 'connected' || (commandBusy && kind !== 'stopAndDisable')) return;
    if (!supportsCommand(kind)) return;
    if (kind !== 'stopAndDisable') {
      if (session.validity !== 'valid' || jointState.source !== 'measured' || jointState.validity !== 'valid' || telemetryWarning !== null
        || commandAuditStatus !== 'ready' || latchedSafetyResult?.sessionId === session.sessionId) return;
      const description = kind === 'home'
        ? '回零可能引发机械臂运动，且当前固件不能确认物理完成。确认现场安全并继续？'
        : kind === 'enable'
          ? '确认物理急停可用、机械臂工作区无人，并使能设备？'
          : kind === 'reset'
            ? '复位可能改变设备状态，且当前固件不能确认完整恢复。继续？'
            : `确认在电机去使能状态下切换到模式 ${mode}？`;
      if (!window.confirm(description)) return;
    }

    const runSequence = ++commandRunSequence.current;
    setCommandBusy(kind);
    setGatewayError(null);
    const identity = commandIdentity();
    try {
      const outcome = await runGatewayCommandLifecycle({
        gateway,
        intent: { ...identity, commandKind: kind },
        operationLabel: '硬件命令',
        execute: () => kind === 'enable'
          ? gateway.enable(identity)
          : kind === 'stopAndDisable'
            ? gateway.stopAndDisable(identity)
            : kind === 'home'
              ? gateway.home(identity)
              : kind === 'reset'
                ? gateway.reset(identity)
                : gateway.setMode({ ...identity, mode: mode! })
      });
      setGatewayError(outcome.transportError ?? outcome.snapshotError);
    } finally {
      if (commandRunSequence.current === runSequence) setCommandBusy(null);
    }
  };

  const commonCommandReason = serialSessionBusy
    ? '串口会话操作正在进行'
    : !gatewayCapabilities
    ? '尚未完成能力协商'
    : !gatewayCapabilities.hardwareCommands
      ? '本机网关未启用硬件命令'
      : session.connectionState !== 'connected'
        ? '机械臂未连接'
        : session.validity !== 'valid'
          ? '反馈不是新鲜有效状态'
          : jointState.source !== 'measured' || jointState.validity !== 'valid'
            ? '关节反馈不是新鲜有效状态'
          : telemetryWarning !== null
            ? '实时遥测尚未恢复；仅允许停止并去使能'
          : commandAuditStatus !== 'ready'
            ? commandAuditStatus === 'loading'
              ? '正在恢复权威命令审计，普通命令暂时锁定'
              : commandAuditStatus === 'error'
                ? '权威命令审计恢复失败；仅允许停止并去使能'
                : '尚未恢复当前会话命令审计'
            : null;
  const uncertainCommandReason = latchedSafetyResult?.sessionId === session.sessionId
    ? '存在未解除的命令安全联锁；仅允许停止并去使能'
    : null;
  const normalCommandReason = commonCommandReason ?? uncertainCommandReason ?? (commandBusy ? '已有命令正在执行；停止链仍可抢占' : null);
  const currentCommandHistory = commandHistory
    .filter((record) => record.sessionId === session.sessionId)
    .slice(-6)
    .reverse();

  return (
    <div className="workspacePage devicesPage">
      <section className="deviceOverview panelSurface">
        <div className="sectionLead">
          <div className="profileMonogram">D6</div>
          <div><span>DUMMY HARDWARE PROFILE</span><h2>{dummyProfile.displayName}</h2><p>{dummyProfile.profileId} · {dummyProfile.model.dof}-DOF MANIPULATOR</p></div>
          <div className="sectionLeadStatus"><span className="statusDot ok" /><strong>PROFILE VALID</strong><SourceTag source="showcase" /></div>
        </div>
        <div className="overviewGrid">
          <InfoCard icon={<Waypoints />} label="MODEL" value="dummy.urdf" detail="Z-UP · METERS" />
          <InfoCard icon={<Cpu />} label="PROTOCOL" value={dummyProfile.protocolAdapterId} detail="ASCII · LF" />
          <InfoCard icon={<HardDrive />} label="TRANSPORT" value={gatewayAvailable ? `${ports.length} PORT${ports.length === 1 ? '' : 'S'}` : '115200 baud'} detail={session.connectionState.toUpperCase()} warning={session.connectionState !== 'connected'} />
          <InfoCard icon={<ShieldCheck />} label="LICENSE" value={dummyProfile.source.license} detail="SOURCE RECORDED" />
        </div>
        <div className="secondaryProfileStrip">
          <div className="secondaryProfileIdentity"><span>A14</span><div><small>CONSOLE PROFILE</small><strong>{aethorRoboProfile.displayName}</strong><p>{aethorRoboProfile.profileId} · TWO 7-DOF ARMS</p></div></div>
          <div className="secondaryProfileState"><span><i className="statusDot ok" />MODEL READY</span><span><i className="statusDot warning" />PROTOCOL PENDING</span><span><i className="statusDot muted" />HARDWARE PENDING</span></div>
          <a href="/console">打开双臂控制台</a>
        </div>
      </section>

      <section className="deviceControls panelSurface">
        <div className="cardHeading"><div><span>HARDWARE SESSION</span><h2>设备连接与安全控制</h2></div><div className={`offlinePill gateway-${session.connectionState}`}><Link2Off size={13} /> {gatewayAvailable ? session.connectionState.toUpperCase() : 'BACKEND ABSENT'}</div></div>
        <div className={visibleGatewayError ? 'hardwareNotice gatewayError' : 'hardwareNotice'}><CircleAlert size={16} /><span>{visibleGatewayError ?? (gatewayAvailable ? (gatewayCapabilities?.commandPolicy === 'engineering' ? 'ENGINEERING DIRECT · 可调试真实机械臂；软件停止不能替代物理急停。' : gatewayCapabilities?.hardwareCommands ? 'SUPERVISED COMMANDS · 每次动作均需人工确认；软件停止不能替代物理急停。' : 'READ-ONLY GATEWAY · 硬件命令未启用。') : `${gateway.unavailableReason ?? '机器人网关未配置'}；静态数据不会提升为在线状态。`)}</span></div>
        <div className="serialConnectRow">
          <label><span>SERIAL PORT</span><select aria-label="串口" value={selectedPort} disabled={!gatewayAvailable || gatewayBusy || serialCatalogBusy || serialSessionBusy || sessionActive} onChange={(event) => setSelectedPort(event.currentTarget.value)}><option value="">{serialCatalogBusy ? '正在扫描…' : serialSessionOperationStatus === 'connecting' ? '正在连接…' : '手动选择端口'}</option>{ports.map((port) => <option key={port.portName} value={port.portName}>{port.displayName ?? port.portName}</option>)}</select></label>
          <button className="gatewayOperation primaryReadOnly" type="button" disabled={!gatewayAvailable || !selectedPort || gatewayBusy || serialCatalogBusy || serialSessionBusy || sessionActive} onClick={() => void connectGateway()}><strong>{serialSessionOperationStatus === 'connecting' ? '连接中' : '连接设备'}</strong><small>EXPLICIT SESSION OPEN</small></button>
          <button className="gatewayOperation" type="button" disabled={!gatewayAvailable || gatewayBusy || serialSessionBusy || !sessionActive || session.connectionState === 'disconnecting' || session.motorState === 'enabled' || commandBusy !== null} title={session.motorState === 'enabled' ? '电机已确认使能；请先停止并去使能' : '释放当前串口；错误端口、陈旧反馈和未知状态均可释放'} onClick={() => void disconnectGateway()}><strong>{serialSessionOperationStatus === 'disconnecting' ? '断开中' : '断开连接'}</strong><small>RELEASE SERIAL</small></button>
          <button className="gatewayOperation" type="button" disabled={!gatewayAvailable || gatewayBusy || serialCatalogBusy || serialSessionBusy} onClick={() => void refreshGateway()}><RefreshCw size={13} /><strong>刷新状态</strong><small>REST SNAPSHOT</small></button>
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
          <HardwareOperation label="使能设备" meta="!START + #GETENABLE" disabledReason={normalCommandReason ?? (!supportsCommand('enable') ? '网关未声明使能能力' : null)} busy={commandBusy === 'enable'} onClick={() => void runCommand('enable')} />
          <HardwareOperation label="停止并去使能" meta="STOP → ZERO → DISABLE" disabledReason={!supportsCommand('stopAndDisable') ? '网关未声明停止能力' : session.connectionState !== 'connected' ? '机械臂未连接' : null} busy={commandBusy === 'stopAndDisable'} danger onClick={() => void runCommand('stopAndDisable')} />
          <HardwareOperation label="回零" meta="ACK ≠ PHYSICAL COMPLETION" disabledReason={normalCommandReason ?? (!supportsCommand('home') ? '网关未声明回零能力' : null)} busy={commandBusy === 'home'} danger onClick={() => void runCommand('home')} />
          <HardwareOperation label="复位" meta="RESULT MAY BE UNCONFIRMED" disabledReason={normalCommandReason ?? (!supportsCommand('reset') ? '网关未声明复位能力' : null)} busy={commandBusy === 'reset'} onClick={() => void runCommand('reset')} />
        </div>
        {lastCommandResult && (
          <div className={`commandResultBanner command-${lastCommandResult.status}`} role="status">
            <div><strong>{lastCommandResult.commandKind.toUpperCase()} · {lastCommandResult.status.toUpperCase()}</strong><span>{lastCommandResult.message}</span></div>
            <code>{lastCommandResult.code} · {lastCommandResult.evidence}</code>
          </div>
        )}
        <div className="modeControl">
          <div><strong>控制模式</strong><span>#CMDMODE 1–3 · 电机去使能后可切换</span></div>
          {dummyProfile.capabilities.controlModes.map((mode) => (
            <Hint content={commonCommandReason ?? (session.motorState === 'enabled' ? '切换模式前必须先去使能' : supportsCommand('setMode') ? '需要人工确认' : '网关未声明模式切换能力')} key={mode}>
              <button type="button" disabled={Boolean(commonCommandReason) || !supportsCommand('setMode') || session.motorState === 'enabled' || commandBusy !== null} onClick={() => void runCommand('setMode', mode)}><span>MODE</span><strong>{mode}</strong></button>
            </Hint>
          ))}
        </div>
      </section>

      <section className="commandAuditSection panelSurface">
        <CommandAuditPanel
          history={currentCommandHistory}
          busy={commandAuditStatus === 'loading'}
          error={commandAuditError}
          canRefresh={gatewayAvailable}
          sessionId={session.sessionId}
          onRefresh={() => void refreshCommandAudit()}
        />
      </section>

      <section className="jointMapping panelSurface">
        <div className="cardHeading"><div><span>URDF / PROTOCOL MAPPING</span><h2>关节映射与限位</h2></div><span className="verifiedLabel"><FileCheck2 size={14} /> 6 / 6 MAPPED</span></div>
        <table className="dataTable jointProfileTable">
          <thead><tr><th>INDEX</th><th>PROFILE ID</th><th>URDF JOINT</th><th>LOWER</th><th>UPPER</th><th>EFFORT</th><th>VELOCITY</th></tr></thead>
          <tbody>{dummyProfile.joints.map((joint) => <tr key={joint.jointId}><td>{joint.protocolIndex}</td><th>{joint.displayName}</th><td><code>{joint.urdfJointName}</code></td><td>{joint.lowerDeg.toFixed(2)}°</td><td>{joint.upperDeg.toFixed(2)}°</td><td><span className="unknownValue">UNVERIFIED</span></td><td><span className="unknownValue">UNVERIFIED</span></td></tr>)}</tbody>
        </table>
        <div className="mappingFootnote"><CircleAlert size={14} /> LOWER / UPPER 使用固件设备角；J3 渲染执行 model = device - 90°，滑条、动作点位与整组下发仍保持 #GETJPOS 坐标。原 URDF 的 effort / velocity 为 0，不能解释为可信硬件上限。</div>
      </section>

      <section className="packageInspector panelSurface">
        <div className="cardHeading"><div><span>MANAGED PROFILE PACKAGE</span><h2>.aethor-robot 校验预览</h2></div><Archive size={18} /></div>
        <p>在浏览器内检查 ZIP 结构、manifest、URDF、关节映射与 mesh 引用。此阶段不会安装或持久化配置包。</p>
        <label className="packageDropzone">
          <input type="file" accept=".aethor-robot,.zip" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void inspectPackage(file);
          }} />
          <Upload size={22} />
          <span>
            <strong>{validating ? '正在验证…' : '选择 .aethor-robot 配置包'}</strong>
            <small>MAX ARCHIVE / UNPACKED 250 MiB · {PROFILE_PACKAGE_LIMITS.fileCount.toLocaleString('en-US')} FILES · LOCAL PREVIEW ONLY</small>
          </span>
        </label>
        {packageResult && (
          <div className={packageResult.valid ? 'packageResult valid' : 'packageResult invalid'}>
            <div>{packageResult.valid ? <PackageCheck size={18} /> : <CircleAlert size={18} />}<span><strong>{packageResult.valid ? 'PACKAGE STRUCTURE VALID' : 'PACKAGE REJECTED'}</strong><small>{packageName} · {packageResult.fileCount} files · {formatBytes(packageResult.unpackedBytes)} · {packageResult.valid ? 'STL PATHS ONLY' : 'NO INSTALL'}</small></span></div>
            {packageResult.profile && <dl><div><dt>PROFILE</dt><dd>{packageResult.profile.profileId}</dd></div><div><dt>DOF</dt><dd>{packageResult.profile.model.dof}</dd></div><div><dt>URDF</dt><dd>{packageResult.profile.model.urdfPath}</dd></div></dl>}
            {packageResult.errors.length > 0 && <ul>{packageResult.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
          </div>
        )}
        <div className="packageRules">
          {['拒绝路径穿越、Windows 路径冲突与外部 URL', '解压前检查 2,048 项 / 250 MiB 总量', 'manifest ≤ 1 MiB · URDF ≤ 8 MiB', '未来由 C# 服务二次验证后安装'].map((rule) => <span key={rule}><CheckCircle2 size={13} />{rule}</span>)}
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
        <DiagnosticExportPanel bridge={bridge} />
      </section>
    </div>
  );
}

function AethorRoboDeviceModelPage({ bridge }: { bridge: DesktopBridgeV1 }) {
  const switchProfile = useActiveRobotProfileStore((state) => state.switchProfile);
  return (
    <div className="workspacePage devicesPage aethorDevicePage" data-profile-id={aethorRoboProfile.profileId}>
      <section className="deviceOverview panelSurface">
        <div className="sectionLead">
          <div className="profileMonogram">A14</div>
          <div><span>SPACE ROBOT PROFILE</span><h2>{aethorRoboProfile.displayName}</h2><p>{aethorRoboProfile.profileId} · TWO 7-DOF ARMS</p></div>
          <div className="sectionLeadStatus"><span className="statusDot ok" /><strong>MODEL VALID</strong><SourceTag source="showcase" /></div>
        </div>
        <div className="overviewGrid">
          <InfoCard icon={<Waypoints />} label="MODEL" value="aethor_robo.urdf" detail="23 LINKS · 23 STL" />
          <InfoCard icon={<Cpu />} label="PROTOCOL" value="PENDING" detail={aethorRoboProfile.protocolAdapterId} warning />
          <InfoCard icon={<HardDrive />} label="TRANSPORT" value="NOT DEFINED" detail="NO SERIAL OWNER" warning />
          <InfoCard icon={<ShieldCheck />} label="LICENSE" value="DECLARED BSD" detail="EXACT TERMS PENDING" warning />
        </div>
        <div className="secondaryProfileStrip">
          <div className="secondaryProfileIdentity"><span>D6</span><div><small>HARDWARE PROFILE</small><strong>{dummyProfile.displayName}</strong><p>{dummyProfile.profileId} · 6-DOF MANIPULATOR</p></div></div>
          <div className="secondaryProfileState"><span><i className="statusDot ok" />GATEWAY DEFINED</span><span><i className="statusDot warning" />GATE B LOCKED</span></div>
          <button className="profileSwitchInline" type="button" onClick={() => switchProfile(dummyProfile.profileId)}>切换到 Dummy</button>
        </div>
      </section>

      <section className="deviceControls panelSurface aethorCapabilityBoundary">
        <div className="cardHeading"><div><span>HARDWARE CONTRACT</span><h2>双臂硬件能力</h2></div><div className="offlinePill gateway-disconnected"><Link2Off size={13} /> OFFLINE</div></div>
        <div className="hardwareNotice"><CircleAlert size={16} /><span>Aethor_robo 固件与统一七轴协议尚未完成。此 Profile 不枚举串口、不消费 Dummy 遥测，也不提供使能、停止、模式或整组下发。</span></div>
        <div className="gatewaySessionGrid">
          <StatusDatum label="LEFT ARM" value="7-DOF MODEL" tone="neutral" />
          <StatusDatum label="RIGHT ARM" value="7-DOF MODEL" tone="neutral" />
          <StatusDatum label="FEEDBACK" value="UNAVAILABLE" tone="warning" />
          <StatusDatum label="COMMANDS" value="LOCKED" tone="warning" />
          <StatusDatum label="WHEELS" value="MODEL ONLY" tone="neutral" />
          <StatusDatum label="ADAPTER" value="AETHOR-ROBO-PENDING" tone="neutral" wide />
        </div>
        <div className="operationGrid phaseFiveOperations">
          <HardwareOperation label="使能设备" meta="PROTOCOL PENDING" disabledReason="Aethor_robo 尚无使能契约" busy={false} onClick={() => undefined} />
          <HardwareOperation label="停止并去使能" meta="PROTOCOL PENDING" disabledReason="Aethor_robo 尚无可验证停止链；请使用物理急停" busy={false} danger onClick={() => undefined} />
          <HardwareOperation label="读取双臂" meta="FEEDBACK PENDING" disabledReason="Aethor_robo 尚无反馈帧定义" busy={false} onClick={() => undefined} />
          <HardwareOperation label="整组下发" meta="2 × 7-DOF LOCKED" disabledReason="缺少限位、速度、到位确认和停止语义" busy={false} danger onClick={() => undefined} />
        </div>
      </section>

      <section className="jointMapping panelSurface">
        <div className="cardHeading"><div><span>URDF / CONTROL GROUPS</span><h2>双七轴映射与预览限位</h2></div><span className="verifiedLabel"><FileCheck2 size={14} /> 14 / 14 MAPPED</span></div>
        <table className="dataTable jointProfileTable">
          <thead><tr><th>INDEX</th><th>GROUP</th><th>PROFILE ID</th><th>URDF JOINT</th><th>PREVIEW LOWER</th><th>PREVIEW UPPER</th><th>HARDWARE</th></tr></thead>
          <tbody>{aethorRoboProfile.joints.map((joint) => {
            const group = aethorRoboJointGroups.find((candidate) => candidate.jointIds.includes(joint.jointId));
            return <tr key={joint.jointId}><td>{joint.protocolIndex}</td><td>{group?.displayName ?? '—'}</td><th>{joint.displayName}</th><td><code>{joint.urdfJointName}</code></td><td>{joint.lowerDeg.toFixed(0)}°</td><td>{joint.upperDeg.toFixed(0)}°</td><td><span className="unknownValue">UNVERIFIED</span></td></tr>;
          })}</tbody>
        </table>
        <div className="mappingFootnote"><CircleAlert size={14} /> 0–360° 仅保留来源 URDF 的本地 FK 预览范围，不是实机限位或安全包络；六个车轮不进入控制组。</div>
      </section>

      <section className="sourceRecord panelSurface">
        <div className="cardHeading"><div><span>PROVENANCE</span><h2>来源与接入边界</h2></div></div>
        <dl className="sourceDetails">
          <div><dt>ORIGINAL URDF SHA-256</dt><dd><code>{aethorRoboProfile.source.urdfSha256}</code></dd></div>
          <div><dt>PROTOCOL REFERENCE</dt><dd><code>{aethorRoboProfile.source.protocolReference}</code></dd></div>
          <div><dt>CONTROL GROUPS</dt><dd><code>left_arm_joint_1…7 / right_arm_joint_1…7</code></dd></div>
          <div><dt>HARDWARE INTEGRATION</dt><dd><span className="unknownValue">A1 BLOCKED</span></dd></div>
        </dl>
        <DiagnosticExportPanel bridge={bridge} />
      </section>
    </div>
  );
}

function DiagnosticExportPanel({ bridge }: { bridge: DesktopBridgeV1 }) {
  const [status, setStatus] = useState<'idle' | 'exporting' | 'exported' | 'notCreated'>('idle');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const available = bridge.capabilities.available && bridge.capabilities.exportDiagnostics;
  const exportBundle = async () => {
    if (!available || status === 'exporting') return;
    setStatus('exporting');
    const exported = await bridge.exportDiagnostics();
    if (mounted.current) setStatus(exported ? 'exported' : 'notCreated');
  };
  const message = !available
    ? '需要 Windows 桌面版；浏览器不会模拟文件导出。'
    : status === 'exporting'
      ? '等待选择保存位置并生成诊断包…'
      : status === 'exported'
        ? '诊断包已生成到所选位置。'
        : status === 'notCreated'
          ? '已取消或未能生成；可查看桌面日志后重试。'
          : '包含脱敏后的有界桌面、WebView2、网关日志和运行环境摘要。';

  return (
    <div className="diagnosticExport" aria-label="桌面诊断包">
      <div>
        <span>SUPPORT BUNDLE</span>
        <strong>桌面诊断包</strong>
        <small>不包含串口终端、命令审计、关节目标或模型文件</small>
      </div>
      <button
        type="button"
        disabled={!available || status === 'exporting'}
        aria-label="导出桌面诊断包"
        onClick={() => void exportBundle()}
      >
        <Download size={14} />{status === 'exporting' ? '生成中' : '导出 ZIP'}
      </button>
      <p className={`diagnosticExportStatus status-${status}`} aria-live="polite">{message}</p>
    </div>
  );
}

function CommandAuditPanel({
  history,
  busy,
  error,
  canRefresh,
  sessionId,
  onRefresh
}: {
  history: CommandAuditRecord[];
  busy: boolean;
  error: string | null;
  canRefresh: boolean;
  sessionId: string;
  onRefresh: () => void;
}) {
  return (
    <div className="commandAuditPanel" aria-label="命令审计">
      <div className="commandAuditHeading">
        <div><span>COMMAND AUDIT · REST AUTHORITY</span><strong>当前会话命令证据</strong></div>
        <div>
          <button type="button" disabled={!canRefresh || busy} aria-label="刷新命令审计" onClick={onRefresh}><RefreshCw size={13} />{busy ? '刷新中' : '刷新'}</button>
          <button type="button" disabled={history.length === 0} aria-label="导出命令审计 JSON" onClick={() => exportCommandAudit(history, sessionId)}><Download size={13} />导出</button>
        </div>
      </div>
      {error && <div className="commandAuditError" role="alert"><CircleAlert size={13} />{error}</div>}
      {!error && history.length === 0 && (
        <div className="commandAuditEmpty">NO COMMAND EVIDENCE · 尚无当前会话硬件命令记录；这不代表连接或执行成功。</div>
      )}
      {history.length > 0 && (
        <div className="commandAuditList" aria-live="polite">
          {history.map((record) => (
            <article className={`commandAuditRow audit-${record.result.status}`} key={record.commandId}>
              <header>
                <span>{record.acceptedAtUtc.slice(11, 19)}Z</span>
                <strong>{record.commandKind.toUpperCase()}</strong>
                <em>{record.result.status.toUpperCase()} · {record.result.evidence}</em>
                {(record.request.payloadTruncated || record.transmissionLogTruncated) && <b>TRUNCATED</b>}
              </header>
              <div className="commandAuditEvidence">
                <span><small>REQUEST</small><code>{formatAuditRequest(record)}</code></span>
                <span><small>TRANSPORT TX</small><code>{record.transmittedPayloads.length > 0 ? record.transmittedPayloads.join(' → ') : 'NO TRANSPORT WRITE'}</code></span>
                <span><small>COMMAND ID</small><code>{record.commandId}</code></span>
                <span><small>REQUEST SHA-256</small><code>{record.request.requestFingerprintSha256}</code></span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatAuditRequest(record: CommandAuditRecord) {
  if (record.request.commandKind === 'setMode') return `MODE ${record.request.mode ?? 'INVALID'}`;
  if (record.request.commandKind === 'jointGroup') {
    const positions = record.request.positionsDeg?.map((value) => value.toFixed(2)).join(', ') ?? 'INVALID TARGET';
    return `J[${positions}] · ${record.request.speedDegS ?? 'NO SPEED'} deg/s · DOF ${record.request.positionsCount ?? 'UNKNOWN'}`;
  }
  return 'NO USER PAYLOAD';
}

function exportCommandAudit(history: CommandAuditRecord[], sessionId: string) {
  const payload = JSON.stringify({
    schemaVersion: 'aethor.command-audit-export.v1',
    exportedAtUtc: new Date().toISOString(),
    profileId: 'dummy-6dof',
    sessionId,
    records: [...history].reverse()
  }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `aethor-command-audit-${sessionId.slice(0, 8)}-${new Date().toISOString().replaceAll(':', '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function InfoCard({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
  return <div className="infoCard"><span className={warning ? 'warning' : ''}>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

function StatusDatum({ label, value, tone, wide = false }: { label: string; value: string; tone: 'ok' | 'warning' | 'error' | 'neutral'; wide?: boolean }) {
  return <div className={wide ? `gatewayDatum ${tone} wide` : `gatewayDatum ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

function HardwareOperation({
  label,
  meta,
  disabledReason,
  busy,
  danger = false,
  onClick
}: {
  label: string;
  meta: string;
  disabledReason: string | null;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <Hint content={disabledReason ?? (danger ? '危险操作：确认现场安全并保持物理急停可用' : '执行前需要人工确认')}>
      <button
        className={danger ? 'disabledOperation danger' : 'disabledOperation'}
        type="button"
        disabled={Boolean(disabledReason) || busy}
        title={disabledReason ?? undefined}
        aria-busy={busy}
        onClick={onClick}
      >
        <span><strong>{busy ? '正在等待终态…' : label}</strong><small>{meta}</small></span>
      </button>
    </Hint>
  );
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}
