import { Cable, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { dummyProfile } from '../../profile/dummyProfile';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { refreshSerialPortCatalog } from '../../integrations/serialPortCatalog';
import { connectSerialSession, disconnectSerialSession } from '../../integrations/serialSessionOperations';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { Hint } from '../ui/Hint';

export function SerialSessionControl({
  gateway,
  enabled
}: {
  gateway: RobotGatewayV1;
  enabled: boolean;
}) {
  const session = useGatewayRuntimeStore((state) => state.session);
  const activePortName = useGatewayRuntimeStore((state) => state.activePortName);
  const setActivePortName = useGatewayRuntimeStore((state) => state.setActivePortName);
  const setSession = useGatewayRuntimeStore((state) => state.setSession);
  const completeDisconnect = useGatewayRuntimeStore((state) => state.completeDisconnect);
  const markTelemetryDegraded = useGatewayRuntimeStore((state) => state.markTelemetryDegraded);
  const ports = useGatewayRuntimeStore((state) => state.serialPorts);
  const portCatalogStatus = useGatewayRuntimeStore((state) => state.serialPortCatalogStatus);
  const portCatalogError = useGatewayRuntimeStore((state) => state.serialPortCatalogError);
  const selectedPort = useGatewayRuntimeStore((state) => state.selectedPortName);
  const setSelectedPort = useGatewayRuntimeStore((state) => state.setSelectedPortName);
  const sessionOperationStatus = useGatewayRuntimeStore((state) => state.serialSessionOperationStatus);
  const sessionOperationError = useGatewayRuntimeStore((state) => state.serialSessionOperationError);
  const error = sessionOperationError ?? portCatalogError;
  const gatewayAvailable = enabled && gateway.capabilities.readOnlyConnection;
  const sessionOpen = session.connectionState !== 'offline';
  const sessionBusy = sessionOperationStatus === 'connecting' || sessionOperationStatus === 'disconnecting';
  const displayedPort = !enabled ? '' : sessionOpen ? activePortName ?? '' : selectedPort;

  const refreshPorts = async () => {
    if (!gatewayAvailable || sessionBusy || sessionOpen) return;
    try {
      await refreshSerialPortCatalog(gateway);
    } catch {
      // The shared catalog store owns the bounded diagnostic error.
    }
  };

  useEffect(() => {
    if (!gatewayAvailable || sessionOpen) return;
    void refreshSerialPortCatalog(gateway).catch(() => undefined);
  }, [gateway, gatewayAvailable, sessionOpen]);

  const connect = async () => {
    if (!gatewayAvailable || !selectedPort || sessionBusy || sessionOpen) return;
    try {
      const nextSession = await connectSerialSession(gateway, { portName: selectedPort, profileId: 'dummy-6dof' });
      setActivePortName(selectedPort);
      useRobotSessionStore.getState().beginHardwareSession(nextSession.sessionId);
      setSession(nextSession);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '串口连接失败';
      try {
        setSession(await gateway.getSession());
      } catch {
        markTelemetryDegraded(`连接结果未知：${message}`);
      }
    }
  };

  const disconnect = async () => {
    if (!canDisconnect(session) || sessionBusy || !gatewayAvailable) return;
    try {
      const nextSession = await disconnectSerialSession(gateway);
      let nextJointState: Awaited<ReturnType<RobotGatewayV1['getJointState']>> | undefined;
      try {
        nextJointState = await gateway.getJointState();
      } catch {
        // The authoritative session is already offline. The restart-like local
        // reset must not retain the previous measured pose if this fetch fails.
      }
      completeDisconnect(nextSession, nextJointState);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '串口断开失败';
      markTelemetryDegraded(`断开结果未知：${message}`);
    }
  };

  const catalogBusy = portCatalogStatus === 'loading';
  const actionReason = getActionDisabledReason({ gatewayAvailable, sessionOpen, session, selectedPort, sessionOperationStatus, catalogBusy });
  const actionLabel = sessionOperationStatus === 'connecting'
    ? '连接中'
    : sessionOperationStatus === 'disconnecting'
      ? '断开中'
      : session.connectionState === 'faulted'
        ? '释放'
        : sessionOpen
          ? '断开'
          : '连接';
  const statusLabel = !enabled
    ? 'Aethor_robo 无串口'
    : !gatewayAvailable
      ? '本机网关未启动'
      : session.connectionState === 'connected'
        ? `${activePortName ?? 'SERIAL'} · ${session.validity.toUpperCase()}`
        : session.connectionState.toUpperCase();
  const options = useMemo(() => {
    if (sessionOpen && activePortName && !ports.some((port) => port.portName === activePortName)) {
      return [{ portName: activePortName, hardwareId: null, displayName: activePortName }, ...ports];
    }
    return ports;
  }, [activePortName, ports, sessionOpen]);

  return (
    <div className={`serialSessionControl state-${session.connectionState}${error ? ' hasError' : ''}`} title={error ?? statusLabel}>
      <Cable className="serialControlIcon" size={15} />
      <label>
        <span><i className={`statusDot ${session.connectionState === 'connected' && session.validity === 'valid' ? 'ok' : error ? 'error' : 'muted'}`} />Serial port</span>
        <select
          aria-label="串口"
          value={displayedPort}
          disabled={!gatewayAvailable || sessionOpen || sessionBusy || catalogBusy}
          onChange={(event) => setSelectedPort(event.currentTarget.value)}
        >
          <option value="">{!enabled ? '不适用' : !gatewayAvailable ? '网关未启动' : catalogBusy ? '正在扫描…' : options.length ? '选择 COM 端口' : '未发现端口'}</option>
          {options.map((port) => <option value={port.portName} key={port.portName}>{port.displayName ?? port.portName}</option>)}
        </select>
      </label>
      <Hint content={sessionOpen ? '连接期间不能切换端口；断开后重新选择。' : '重新枚举本机串口，不会自动连接。'}>
        <button className="serialRefreshButton" type="button" aria-label="刷新串口" disabled={!gatewayAvailable || sessionOpen || sessionBusy || catalogBusy} onClick={() => void refreshPorts()}><RefreshCw size={14} /></button>
      </Hint>
      <Hint content={actionReason ?? (sessionOpen ? '释放当前串口会话' : `连接 ${selectedPort}`)}>
        <button className="serialActionButton" type="button" disabled={Boolean(actionReason)} aria-busy={sessionBusy} onClick={() => void (sessionOpen ? disconnect() : connect())}>{actionLabel}</button>
      </Hint>
      <span className="visuallyHidden" role={error ? 'alert' : 'status'} aria-live="polite">{error ?? statusLabel}</span>
    </div>
  );
}

function canDisconnect(session: ReturnType<typeof useGatewayRuntimeStore.getState>['session']) {
  if (session.connectionState === 'offline' || session.connectionState === 'disconnecting') return false;
  return session.motorState !== 'enabled';
}

function getActionDisabledReason({ gatewayAvailable, sessionOpen, session, selectedPort, sessionOperationStatus, catalogBusy }: {
  gatewayAvailable: boolean;
  sessionOpen: boolean;
  session: ReturnType<typeof useGatewayRuntimeStore.getState>['session'];
  selectedPort: string;
  sessionOperationStatus: ReturnType<typeof useGatewayRuntimeStore.getState>['serialSessionOperationStatus'];
  catalogBusy: boolean;
}) {
  if (!gatewayAvailable) return '当前 Profile 没有可用的本机串口网关';
  if (sessionOperationStatus === 'connecting' || sessionOperationStatus === 'disconnecting') return '串口操作正在进行';
  if (catalogBusy) return '正在枚举本机串口';
  if (!sessionOpen) return selectedPort ? null : '请先选择一个 COM 端口';
  if (session.connectionState === 'disconnecting') return '串口正在释放';
  if (session.motorState === 'enabled') return '电机已确认使能；请先停止并去使能';
  return null;
}
