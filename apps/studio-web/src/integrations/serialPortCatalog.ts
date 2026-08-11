import type { SerialPortDescriptor } from '@aethor/contracts';
import type { RobotGatewayV1 } from './robotGateway';
import { classifyOperationFailure, emitOperationProbe } from './operationProbe';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';

const inFlightByGateway = new WeakMap<RobotGatewayV1, Promise<SerialPortDescriptor[]>>();

export function refreshSerialPortCatalog(gateway: RobotGatewayV1) {
  const existing = inFlightByGateway.get(gateway);
  if (existing) return existing;

  const operationId = crypto.randomUUID();
  const startedAt = performance.now();
  const runtime = useGatewayRuntimeStore.getState();
  runtime.beginSerialPortRefresh();
  emitOperationProbe({
    eventId: 'frontend.serial.catalog.started',
    operationId,
    outcome: 'started'
  });

  const operation = gateway.listSerialPorts(operationId)
    .then((ports) => {
      useGatewayRuntimeStore.getState().completeSerialPortRefresh(ports, new Date().toISOString());
      emitOperationProbe({
        eventId: 'frontend.serial.catalog.completed',
        operationId,
        outcome: 'completed',
        durationMs: performance.now() - startedAt,
        resultCount: ports.length
      });
      return ports;
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : '串口枚举失败';
      useGatewayRuntimeStore.getState().failSerialPortRefresh(message);
      emitOperationProbe({
        eventId: 'frontend.serial.catalog.failed',
        operationId,
        outcome: 'failed',
        durationMs: performance.now() - startedAt,
        failureCategory: classifyOperationFailure(cause)
      });
      throw cause;
    })
    .finally(() => {
      if (inFlightByGateway.get(gateway) === operation) inFlightByGateway.delete(gateway);
    });

  inFlightByGateway.set(gateway, operation);
  return operation;
}
