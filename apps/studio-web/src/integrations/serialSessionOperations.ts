import type { RobotConnectRequest, RobotSessionSnapshot } from '@aethor/contracts';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import { classifyOperationFailure, emitOperationProbe } from './operationProbe';
import type { RobotGatewayV1 } from './robotGateway';

type SerialSessionOperationKind = 'connect' | 'disconnect';

interface InFlightSerialSessionOperation {
  kind: SerialSessionOperationKind;
  identity: string;
  promise: Promise<RobotSessionSnapshot>;
}

const inFlightByGateway = new WeakMap<RobotGatewayV1, InFlightSerialSessionOperation>();

export class SerialSessionOperationConflict extends Error {
  constructor(activeKind: SerialSessionOperationKind) {
    super(`串口会话正在${activeKind === 'connect' ? '连接' : '断开'}；请等待当前操作结束`);
    this.name = 'SerialSessionOperationConflict';
  }
}

export function connectSerialSession(gateway: RobotGatewayV1, request: RobotConnectRequest) {
  return runSerialSessionOperation(
    gateway,
    'connect',
    `${request.profileId}:${request.portName.toUpperCase()}`,
    (operationId) => gateway.connect(request, operationId)
  );
}

export function disconnectSerialSession(gateway: RobotGatewayV1) {
  return runSerialSessionOperation(
    gateway,
    'disconnect',
    'disconnect',
    (operationId) => gateway.disconnect(operationId)
  );
}

function runSerialSessionOperation(
  gateway: RobotGatewayV1,
  kind: SerialSessionOperationKind,
  identity: string,
  execute: (operationId: string) => Promise<RobotSessionSnapshot>
) {
  const existing = inFlightByGateway.get(gateway);
  if (existing) {
    if (existing.kind === kind && existing.identity === identity) return existing.promise;
    return Promise.reject(new SerialSessionOperationConflict(existing.kind));
  }

  const operationId = crypto.randomUUID();
  const startedAt = performance.now();
  useGatewayRuntimeStore.getState().beginSerialSessionOperation(kind === 'connect' ? 'connecting' : 'disconnecting');
  emitOperationProbe({
    eventId: `frontend.serial.session.${kind}.started`,
    operationId,
    outcome: 'started'
  });

  const promise = execute(operationId)
    .then((snapshot) => {
      useGatewayRuntimeStore.getState().completeSerialSessionOperation();
      emitOperationProbe({
        eventId: `frontend.serial.session.${kind}.completed`,
        operationId,
        outcome: 'completed',
        durationMs: performance.now() - startedAt
      });
      return snapshot;
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : '串口会话操作失败';
      useGatewayRuntimeStore.getState().failSerialSessionOperation(message);
      emitOperationProbe({
        eventId: `frontend.serial.session.${kind}.failed`,
        operationId,
        outcome: 'failed',
        durationMs: performance.now() - startedAt,
        failureCategory: classifyOperationFailure(cause)
      });
      throw cause;
    })
    .finally(() => {
      if (inFlightByGateway.get(gateway)?.promise === promise) inFlightByGateway.delete(gateway);
    });

  inFlightByGateway.set(gateway, { kind, identity, promise });
  return promise;
}
