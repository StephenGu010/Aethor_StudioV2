import { describe, expect, it, vi } from 'vitest';
import { createRobotGateway } from './gatewayInstance';
import { HttpRobotGateway, normalizeLoopbackGatewayUrl } from './httpRobotGateway';
import { StaticShowcaseSource } from './staticShowcaseSource';

const token = '0123456789abcdef0123456789abcdef';

describe('HttpRobotGateway read-only boundary', () => {
  it('accepts only loopback origins without credentials or paths', () => {
    expect(normalizeLoopbackGatewayUrl('http://127.0.0.1:5127')).toBe('http://127.0.0.1:5127');
    expect(normalizeLoopbackGatewayUrl('http://localhost:5127/')).toBe('http://localhost:5127');
    expect(() => normalizeLoopbackGatewayUrl('http://192.168.1.20:5127')).toThrow(/loopback/);
    expect(() => normalizeLoopbackGatewayUrl('http://127.0.0.1:5127/api')).toThrow(/loopback/);
    expect(() => normalizeLoopbackGatewayUrl('http://user:pass@127.0.0.1:5127')).toThrow(/credentials/);
  });

  it('authenticates port enumeration and validates the wire shape', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { portName: 'COM4', hardwareId: null, displayName: 'COM4' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.listSerialPorts()).resolves.toEqual([
      { portName: 'COM4', hardwareId: null, displayName: 'COM4' }
    ]);
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:5127/api/v1/serial/ports');
    expect(new Headers(init?.headers).get('X-Aethor-Session')).toBe(token);
  });

  it('rejects malformed gateway data instead of treating it as measured state', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { portName: 'not-a-com-port', hardwareId: null, displayName: null }
    ]), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.listSerialPorts()).rejects.toMatchObject({ status: 502 });
  });

  it('never sends Phase 5 commands through the Phase 4 HTTP adapter', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.sendJointGroup({
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof', positionsDeg: [0, 0, 0, 0, 0, 0]
    })).resolves.toMatchObject({ status: 'unsupported' });
    await expect(gateway.sendRaw('cmd-2', '!START')).resolves.toMatchObject({ status: 'unsupported' });
    await expect(gateway.emergencyStop('cmd-3')).resolves.toMatchObject({ status: 'unsupported' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to an explicitly unavailable showcase source for missing or unsafe config', () => {
    expect(createRobotGateway({})).toBeInstanceOf(StaticShowcaseSource);
    expect(createRobotGateway({ VITE_AETHOR_GATEWAY_URL: 'http://127.0.0.1:5127' }).unavailableReason).toMatch(/配置不完整/);
    expect(createRobotGateway({
      VITE_AETHOR_GATEWAY_URL: 'http://192.168.1.10:5127',
      VITE_AETHOR_GATEWAY_SESSION_TOKEN: token
    }).unavailableReason).toMatch(/配置被拒绝/);
  });
});
