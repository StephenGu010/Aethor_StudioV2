import type { CommandResult, RobotCommandKind } from '@aethor/contracts';
import { createUnconfirmedTransportResult } from '../domain/commandSafety';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import type { RobotGatewayV1 } from './robotGateway';

export interface GatewayCommandIntent {
  commandId: string;
  sessionId: string;
  commandKind: RobotCommandKind;
}

export interface GatewayCommandLifecycleOutcome {
  result: CommandResult;
  transportError: string | null;
  snapshotError: string | null;
  auditError: string | null;
  reconciliationSuperseded: boolean;
}

const refreshSequenceByGateway = new WeakMap<RobotGatewayV1, number>();

export async function runGatewayCommandLifecycle({
  gateway,
  intent,
  operationLabel,
  execute
}: {
  gateway: RobotGatewayV1;
  intent: GatewayCommandIntent;
  operationLabel: string;
  execute: () => Promise<CommandResult>;
}): Promise<GatewayCommandLifecycleOutcome> {
  const refreshSequence = (refreshSequenceByGateway.get(gateway) ?? 0) + 1;
  refreshSequenceByGateway.set(gateway, refreshSequence);
  const isCurrentRefresh = () => refreshSequenceByGateway.get(gateway) === refreshSequence;

  let result: CommandResult;
  try {
    result = await execute();
  } catch (error) {
    const transportError = safeErrorMessage(error, `${operationLabel}请求失败；物理结果未知`);
    result = createUnconfirmedTransportResult({
      ...intent,
      message: `${operationLabel}请求的物理结果未知：${transportError}`
    });
    const runtime = useGatewayRuntimeStore.getState();
    runtime.setLastCommandResult(result);
    runtime.markTelemetryDegraded(`${operationLabel}请求响应丢失；当前实测状态已降级为陈旧`);
    if (isCurrentRefresh()) runtime.failCommandAuditRefresh(`${operationLabel}请求失败，命令审计尚未重新核对`);
    return {
      result,
      transportError,
      snapshotError: null,
      auditError: `${operationLabel}请求失败，命令审计尚未重新核对`,
      reconciliationSuperseded: !isCurrentRefresh()
    };
  }

  useGatewayRuntimeStore.getState().setLastCommandResult(result);
  if (!isCurrentRefresh()) return {
    result,
    transportError: null,
    snapshotError: null,
    auditError: null,
    reconciliationSuperseded: true
  };

  useGatewayRuntimeStore.getState().beginCommandAuditRefresh();
  const [snapshotRefresh, auditRefresh] = await Promise.allSettled([
    Promise.all([gateway.getSession(), gateway.getJointState()]),
    gateway.getCommandHistory()
  ]);
  if (!isCurrentRefresh()) return {
    result,
    transportError: null,
    snapshotError: null,
    auditError: null,
    reconciliationSuperseded: true
  };

  let snapshotError: string | null = null;
  let auditError: string | null = null;
  const runtime = useGatewayRuntimeStore.getState();
  if (snapshotRefresh.status === 'fulfilled') {
    const [session, jointState] = snapshotRefresh.value;
    const preserveDegradedTelemetry = runtime.session.validity === 'stale'
      || runtime.jointState.validity === 'stale';
    runtime.setSession(session);
    runtime.setJointState(jointState);
    if (preserveDegradedTelemetry) {
      runtime.markTelemetryDegraded(runtime.transportWarning ?? '实时遥测尚未恢复；REST 快照仅代表刷新时刻');
    }
  } else {
    snapshotError = `命令已返回 ${result.status}，但权威状态刷新失败：${safeErrorMessage(snapshotRefresh.reason, '未知错误')}`;
    runtime.markTelemetryDegraded(snapshotError);
  }
  if (auditRefresh.status === 'fulfilled') {
    runtime.replaceCommandHistory(auditRefresh.value);
  } else {
    auditError = `命令终态已收到，但审计记录恢复失败：${safeErrorMessage(auditRefresh.reason, '未知错误')}`;
    runtime.failCommandAuditRefresh(auditError);
  }

  return {
    result,
    transportError: null,
    snapshotError,
    auditError,
    reconciliationSuperseded: false
  };
}

function safeErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
