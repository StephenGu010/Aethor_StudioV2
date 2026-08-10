import { CircleAlert, RadioTower } from 'lucide-react';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';

export function GlobalSafetyAlert() {
  const latchedSafetyResult = useGatewayRuntimeStore((state) => state.latchedSafetyResult);
  const commandAuditStatus = useGatewayRuntimeStore((state) => state.commandAuditStatus);
  const commandAuditError = useGatewayRuntimeStore((state) => state.commandAuditError);
  const transportWarning = useGatewayRuntimeStore((state) => state.transportWarning);
  const session = useGatewayRuntimeStore((state) => state.session);
  const jointState = useGatewayRuntimeStore((state) => state.jointState);

  if (latchedSafetyResult) {
    const isStop = latchedSafetyResult.commandKind === 'stopAndDisable';
    const resultUnknown = ['unconfirmed', 'timedOut'].includes(latchedSafetyResult.status);
    const title = isStop
      ? resultUnknown ? 'SOFTWARE STOP UNCONFIRMED' : 'SOFTWARE STOP FAILED'
      : 'CONTROL INTERLOCK LATCHED';
    const guidance = isStop
      ? '立即使用物理急停，并现场核对电机使能与设备状态。'
      : '普通控制已锁定；仅保留停止并去使能，直至获得明确终态。';
    return (
      <div className="globalRuntimeAlert danger" role="alert">
        <CircleAlert size={15} aria-hidden="true" />
        <strong>{title}</strong>
        <span>{latchedSafetyResult.message} · {guidance}</span>
      </div>
    );
  }

  if (commandAuditStatus === 'error') {
    return (
      <div className="globalRuntimeAlert warning" role="alert">
        <CircleAlert size={15} aria-hidden="true" />
        <strong>COMMAND AUTHORITY UNAVAILABLE</strong>
        <span>{commandAuditError ?? '权威命令审计不可用'} · 普通控制保持锁定，仅保留停止并去使能。</span>
      </div>
    );
  }

  const measuredTelemetryStale = (session.source === 'measured' && session.validity !== 'valid')
    || (jointState.source === 'measured' && jointState.validity !== 'valid');
  if (measuredTelemetryStale) {
    return (
      <div className="globalRuntimeAlert telemetry" role="status">
        <RadioTower size={15} aria-hidden="true" />
        <strong>TELEMETRY DEGRADED</strong>
        <span>{transportWarning ?? '实测数据已陈旧'} · 保留最后实测值仅供识别，不允许据此下发运动。</span>
      </div>
    );
  }

  if (transportWarning) {
    return (
      <div className="globalRuntimeAlert warning" role="alert">
        <CircleAlert size={15} aria-hidden="true" />
        <strong>GATEWAY WARNING</strong>
        <span>{transportWarning}</span>
      </div>
    );
  }

  return null;
}
