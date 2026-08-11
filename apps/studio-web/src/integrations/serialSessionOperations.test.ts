import type { RobotConnectRequest, RobotSessionSnapshot } from '@aethor/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import type { RobotGatewayV1 } from './robotGateway';
import {
  connectSerialSession,
  disconnectSerialSession,
  SerialSessionOperationConflict
} from './serialSessionOperations';

describe('serial session operation owner', () => {
  beforeEach(() => useGatewayRuntimeStore.getState().resetRuntime());

  it('coalesces the same connect intent and carries one operation id to the gateway', async () => {
    const pending = deferred<RobotSessionSnapshot>();
    const connect = vi.fn((_request, _operationId?: string) => pending.promise);
    const gateway = { connect } as unknown as RobotGatewayV1;
    const request = { portName: 'COM4', profileId: 'dummy-6dof' } satisfies RobotConnectRequest;

    const first = connectSerialSession(gateway, request);
    const second = connectSerialSession(gateway, request);

    expect(first).toBe(second);
    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(request, expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialSessionOperationStatus: 'connecting',
      serialSessionOperationError: null
    });

    pending.resolve(connectedSession());
    await expect(first).resolves.toMatchObject({ connectionState: 'connected' });
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialSessionOperationStatus: 'idle',
      serialSessionOperationError: null
    });
  });

  it('rejects a conflicting release without starting a second physical operation', async () => {
    const pending = deferred<RobotSessionSnapshot>();
    const connect = vi.fn(() => pending.promise);
    const disconnect = vi.fn(async () => offlineSession());
    const gateway = { connect, disconnect } as unknown as RobotGatewayV1;

    const active = connectSerialSession(gateway, { portName: 'COM4', profileId: 'dummy-6dof' });
    await expect(disconnectSerialSession(gateway)).rejects.toBeInstanceOf(SerialSessionOperationConflict);
    expect(disconnect).not.toHaveBeenCalled();

    pending.resolve(connectedSession());
    await active;
  });

  it('coalesces concurrent disconnect intent and carries one operation id', async () => {
    const pending = deferred<RobotSessionSnapshot>();
    const disconnect = vi.fn((_operationId?: string) => pending.promise);
    const gateway = { disconnect } as unknown as RobotGatewayV1;

    const first = disconnectSerialSession(gateway);
    const second = disconnectSerialSession(gateway);

    expect(first).toBe(second);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(useGatewayRuntimeStore.getState().serialSessionOperationStatus).toBe('disconnecting');

    pending.resolve(offlineSession());
    await expect(first).resolves.toMatchObject({ connectionState: 'offline' });
    expect(useGatewayRuntimeStore.getState().serialSessionOperationStatus).toBe('idle');
  });

  it('publishes a bounded shared failure state and allows a later retry', async () => {
    const consoleProbe = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const connect = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('网关请求失败（HTTP 409）'), { status: 409 }))
      .mockResolvedValueOnce(connectedSession());
    const gateway = { connect } as unknown as RobotGatewayV1;
    const request = { portName: 'COM4', profileId: 'dummy-6dof' } satisfies RobotConnectRequest;

    await expect(connectSerialSession(gateway, request)).rejects.toThrow(/409/);
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialSessionOperationStatus: 'error',
      serialSessionOperationError: '网关请求失败（HTTP 409）'
    });
    expect(consoleProbe).toHaveBeenCalledWith(expect.stringContaining('"failureCategory":"conflict"'));

    await expect(connectSerialSession(gateway, request)).resolves.toMatchObject({ connectionState: 'connected' });
    expect(connect).toHaveBeenCalledTimes(2);
    consoleProbe.mockRestore();
  });
});

function connectedSession(): RobotSessionSnapshot {
  return {
    sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
    controlMode: 2, timestampUtc: '2026-08-11T00:00:00.000Z', source: 'measured', validity: 'valid'
  };
}

function offlineSession(): RobotSessionSnapshot {
  return {
    sessionId: 'offline', profileId: 'dummy-6dof', connectionState: 'offline', motorState: 'unknown',
    controlMode: null, timestampUtc: '2026-08-11T00:00:01.000Z', source: 'unavailable', validity: 'unavailable'
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
