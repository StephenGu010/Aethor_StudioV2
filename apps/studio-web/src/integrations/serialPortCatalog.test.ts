import type { SerialPortDescriptor } from '@aethor/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RobotGatewayV1 } from './robotGateway';
import { refreshSerialPortCatalog } from './serialPortCatalog';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';

describe('shared serial port catalog', () => {
  beforeEach(() => {
    useGatewayRuntimeStore.getState().resetRuntime();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('coalesces concurrent scans and publishes one bounded result', async () => {
    const pending = deferred<SerialPortDescriptor[]>();
    const listSerialPorts = vi.fn((_operationId?: string) => pending.promise);
    const gateway = { listSerialPorts } as unknown as RobotGatewayV1;

    const first = refreshSerialPortCatalog(gateway);
    const second = refreshSerialPortCatalog(gateway);

    expect(first).toBe(second);
    expect(listSerialPorts).toHaveBeenCalledOnce();
    expect(listSerialPorts.mock.calls[0]?.[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(useGatewayRuntimeStore.getState().serialPortCatalogStatus).toBe('loading');

    pending.resolve([
      { portName: 'COM1', hardwareId: null, displayName: 'COM1' },
      { portName: 'COM4', hardwareId: null, displayName: 'COM4' }
    ]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialPortCatalogStatus: 'ready',
      serialPortCatalogError: null,
      serialPorts: [{ portName: 'COM1' }, { portName: 'COM4' }]
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}
