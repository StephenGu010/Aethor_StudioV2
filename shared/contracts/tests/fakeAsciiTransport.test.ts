import { describe, expect, it, vi } from 'vitest';
import { FakeAsciiTransport } from '../src/testing';
import { TransportCancelledError, TransportCapacityError, TransportUnavailableError } from '../src/transport';

describe('FakeAsciiTransport', () => {
  it('models explicit open, bounded writes, receive chunks and close', async () => {
    const transport = new FakeAsciiTransport({ maxWrites: 2 });
    const onData = vi.fn();
    const onState = vi.fn();
    const offData = transport.onData(onData);
    transport.onState(onState);

    await expect(transport.write('#GETJPOS\n')).rejects.toBeInstanceOf(TransportUnavailableError);
    await transport.open();
    await transport.write('#GETJPOS\n');
    await transport.write('#GETMODE\n');
    await expect(transport.write('#GETENABLE\n')).rejects.toBeInstanceOf(TransportCapacityError);
    transport.injectReceivedChunk('ok 1');
    expect(onData).toHaveBeenCalledWith('ok 1');
    expect(transport.writtenPayloads()).toEqual(['#GETJPOS\n', '#GETMODE\n']);
    offData();
    await transport.close();
    expect(onState).toHaveBeenLastCalledWith({ state: 'closed' });
  });

  it('honors cancellation and deterministically releases listeners and buffers', async () => {
    const transport = new FakeAsciiTransport();
    const controller = new AbortController();
    controller.abort();
    await expect(transport.open(controller.signal)).rejects.toBeInstanceOf(TransportCancelledError);
    const off = transport.onData(() => undefined);
    expect(transport.listenerCounts().data).toBe(1);
    off();
    transport.dispose();
    expect(transport.listenerCounts()).toEqual({ data: 0, state: 0 });
    expect(transport.writtenPayloads()).toEqual([]);
  });
});
