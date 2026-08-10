import { describe, expect, it, vi } from 'vitest';
import { createRobotGateway } from './gatewayInstance';
import { HttpRobotGateway, normalizeLoopbackGatewayUrl } from './httpRobotGateway';
import { StaticShowcaseSource } from './staticShowcaseSource';

const token = '0123456789abcdef0123456789abcdef';

describe('HttpRobotGateway boundary', () => {
  it('accepts only loopback origins without credentials or paths', () => {
    expect(normalizeLoopbackGatewayUrl('http://127.0.0.1:5127')).toBe('http://127.0.0.1:5127');
    expect(normalizeLoopbackGatewayUrl('http://localhost:5127/')).toBe('http://localhost:5127');
    expect(() => normalizeLoopbackGatewayUrl('http://192.168.1.20:5127')).toThrow(/loopback/);
    expect(() => normalizeLoopbackGatewayUrl('http://127.0.0.1:5127/api')).toThrow(/loopback/);
    expect(() => normalizeLoopbackGatewayUrl('http://user:pass@127.0.0.1:5127')).toThrow(/credentials/);
  });

  it('rejects non-printable session tokens before constructing request headers', () => {
    expect(() => new HttpRobotGateway({
      baseUrl: 'http://127.0.0.1:5127',
      sessionToken: `${token.slice(0, -1)}\n`
    })).toThrow(/printable ASCII/);
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

  it('keeps commands disabled until capability negotiation explicitly enables them', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      contractVersion: '1.2', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: false,
      commandPolicy: 'supervised', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['enable', 'stopAndDisable', 'home', 'reset', 'setMode'],
      jointGroupSpeedLimitDegS: null,
      jointGroupCompletion: null,
      engineeringJointSpeedMaxDegS: null
    }), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    expect(gateway.capabilities.hardwareCommands).toBe(false);
    await gateway.getCapabilities();
    expect(gateway.capabilities).toMatchObject({ hardwareCommands: true, commandPolicy: 'supervised' });
    expect(gateway.capabilities.supportedCommands).not.toContain('jointGroup');
  });

  it('rejects internally inconsistent capability negotiation without enabling commands', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      contractVersion: '1.2', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: false,
      commandPolicy: 'supervised', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['jointGroup'], jointGroupSpeedLimitDegS: null, jointGroupCompletion: null,
      engineeringJointSpeedMaxDegS: null
    }), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.getCapabilities()).rejects.toMatchObject({ status: 502 });
    expect(gateway.capabilities.hardwareCommands).toBe(false);
  });

  it('negotiates engineering direct capability and posts a single validated line', async () => {
    const responses = [
      {
        contractVersion: '1.2', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
        readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: true,
        commandPolicy: 'engineering', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
        supportedCommands: ['enable', 'stopAndDisable', 'setMode'], jointGroupSpeedLimitDegS: null,
        jointGroupCompletion: null, engineeringJointSpeedMaxDegS: 100
      },
      {
        requestId: 'direct-1', sessionId: 'session-1', status: 'replied', evidence: 'feedbackConfirmed',
        normalizedLine: '#GETJPOS', message: 'reply', timestampUtc: '2026-08-10T00:00:00.000Z',
        deviceReply: 'ok 0 0 0 0 0 0'
      }
    ];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await gateway.getCapabilities();
    await expect(gateway.sendDirectCommand({
      requestId: 'direct-1', sessionId: 'session-1', profileId: 'dummy-6dof', line: '#GETJPOS'
    })).resolves.toMatchObject({ status: 'replied', deviceReply: 'ok 0 0 0 0 0 0' });

    expect(gateway.capabilities).toMatchObject({ commandPolicy: 'engineering', rawCommand: true, engineeringJointSpeedMaxDegS: 100 });
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe('http://127.0.0.1:5127/api/v1/engineering/direct-command');
  });

  it('accepts bounded command request evidence and rejects inconsistent audit identities', async () => {
    const result = {
      commandId: 'mode-audit', sessionId: 'session-1', commandKind: 'setMode', status: 'completed',
      code: 'ok', evidence: 'feedbackConfirmed', message: 'mode confirmed', timestampUtc: '2026-08-09T00:00:01.000Z'
    };
    const audit = {
      commandId: 'mode-audit', sessionId: 'session-1', profileId: 'dummy-6dof', commandKind: 'setMode',
      acceptedAtUtc: '2026-08-09T00:00:00.000Z',
      request: {
        commandKind: 'setMode', requestFingerprintSha256: 'A'.repeat(64), mode: 2,
        positionsDeg: null, positionsCount: null, speedDegS: null, payloadTruncated: false
      },
      transmittedPayloads: ['#CMDMODE 2', '#GETMODE'],
      transmissionLogTruncated: false,
      result
    };
    const validFetcher = vi.fn(async () => new Response(JSON.stringify([audit]), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, validFetcher);
    await expect(gateway.getCommandHistory()).resolves.toEqual([audit]);

    const invalidFetcher = vi.fn(async () => new Response(JSON.stringify([{
      ...audit,
      request: { ...audit.request, commandKind: 'enable', mode: null }
    }]), { status: 200 })) as unknown as typeof fetch;
    const invalidGateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, invalidFetcher);
    await expect(invalidGateway.getCommandHistory()).rejects.toMatchObject({ status: 502 });
  });

  it('sends only structured command DTOs to typed endpoints', async () => {
    const result = {
      commandId: 'cmd-1', sessionId: 'session-1', commandKind: 'enable', status: 'completed',
      code: 'ok', evidence: 'feedbackConfirmed', message: 'confirmed', timestampUtc: '2026-08-09T00:00:00.000Z'
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.enable({ commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof' }))
      .resolves.toMatchObject({ status: 'completed', evidence: 'feedbackConfirmed' });

    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:5127/api/v1/commands/enable');
    expect(JSON.parse(String(init?.body))).toEqual({
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof'
    });
  });

  it('reports SignalR degradation and recovery as separate lifecycle events', async () => {
    let reconnecting: (() => void) | undefined;
    let reconnected: (() => void) | undefined;
    let closed: (() => void) | undefined;
    const connection = {
      on: vi.fn(),
      onreconnecting: vi.fn((handler: () => void) => { reconnecting = handler; }),
      onreconnected: vi.fn((handler: () => void) => { reconnected = handler; }),
      onclose: vi.fn((handler: () => void) => { closed = handler; }),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {})
    };
    const gateway = new HttpRobotGateway(
      { baseUrl: 'http://127.0.0.1:5127', sessionToken: token },
      globalThis.fetch.bind(globalThis),
      () => connection as never
    );
    const onTransportError = vi.fn();
    const onTransportRecovered = vi.fn();

    const closeTelemetry = await gateway.openTelemetry({ onTransportError, onTransportRecovered });
    reconnecting?.();
    expect(onTransportError).toHaveBeenCalledWith({
      kind: 'reconnecting',
      message: expect.stringContaining('正在重连')
    });
    reconnected?.();
    expect(onTransportRecovered).toHaveBeenCalledOnce();
    closed?.();
    expect(onTransportError).toHaveBeenLastCalledWith({
      kind: 'closed',
      message: expect.stringContaining('已断开')
    });

    await closeTelemetry();
    expect(connection.stop).toHaveBeenCalledOnce();
  });

  it('falls back to an explicitly unavailable showcase source for missing or unsafe config', () => {
    expect(createRobotGateway({})).toBeInstanceOf(StaticShowcaseSource);
    expect(createRobotGateway({ VITE_AETHOR_GATEWAY_URL: 'http://127.0.0.1:5127' }).unavailableReason).toBeTruthy();
    expect(createRobotGateway({
      VITE_AETHOR_GATEWAY_URL: 'http://192.168.1.10:5127',
      VITE_AETHOR_GATEWAY_SESSION_TOKEN: token
    }).unavailableReason).toBeTruthy();
  });

  it('accepts the host-injected loopback configuration without baking credentials into Vite', () => {
    expect(createRobotGateway({}, {
      contractVersion: '1.0', gateway: { baseUrl: 'http://127.0.0.1:54321', sessionToken: token },
      capabilities: { available: true, minimize: true, toggleMaximize: true, close: true }
    })).toBeInstanceOf(HttpRobotGateway);
  });
});
