import { describe, expect, it, vi } from 'vitest';
import { createRobotGateway, resolveRobotGatewayConfig } from './gatewayInstance';
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
    expect(new Headers(init?.headers).get('X-Aethor-Operation')).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('rejects malformed gateway data instead of treating it as measured state', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      { portName: 'not-a-com-port', hardwareId: null, displayName: null }
    ]), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.listSerialPorts()).rejects.toMatchObject({ status: 502 });
  });

  it('carries caller operation ids on serial connect and disconnect requests', async () => {
    const snapshots = [
      {
        sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
        controlMode: 2, timestampUtc: '2026-08-11T00:00:00.000Z', source: 'measured', validity: 'valid'
      },
      {
        sessionId: 'offline', profileId: 'dummy-6dof', connectionState: 'offline', motorState: 'unknown',
        controlMode: null, timestampUtc: '2026-08-11T00:00:01.000Z', source: 'unavailable', validity: 'unavailable'
      }
    ];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshots.shift()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);
    const connectOperationId = '11111111-1111-4111-8111-111111111111';
    const disconnectOperationId = '22222222-2222-4222-8222-222222222222';

    await gateway.connect({ portName: 'COM4', profileId: 'dummy-6dof' }, connectOperationId);
    await gateway.disconnect(disconnectOperationId);

    expect(new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers).get('X-Aethor-Operation')).toBe(connectOperationId);
    expect(new Headers(vi.mocked(fetcher).mock.calls[1]?.[1]?.headers).get('X-Aethor-Operation')).toBe(disconnectOperationId);
  });

  it('keeps commands disabled until capability negotiation explicitly enables them', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
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
      contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
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
        contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
        readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: true,
        commandPolicy: 'engineering', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
        supportedCommands: ['enable', 'stopAndDisable', 'setMode'], jointGroupSpeedLimitDegS: null,
        jointGroupCompletion: null, engineeringJointSpeedMaxDegS: 100
      },
      {
        requestId: 'direct-1', sessionId: 'session-1', status: 'queued', evidence: 'gatewayAccepted',
        normalizedLine: '#GETJPOS', message: 'queued', timestampUtc: '2026-08-10T00:00:00.000Z'
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
    })).resolves.toMatchObject({ status: 'queued', evidence: 'gatewayAccepted' });

    expect(gateway.capabilities).toMatchObject({ commandPolicy: 'engineering', rawCommand: true, engineeringJointSpeedMaxDegS: 100 });
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe('http://127.0.0.1:5127/api/v1/engineering/direct-command');
  });

  it('uses the normal bounded HTTP window for a write-only engineering joint request', async () => {
    const responses = [
      {
        contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
        readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: true,
        commandPolicy: 'engineering', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
        supportedCommands: ['enable', 'stopAndDisable', 'setMode'], jointGroupSpeedLimitDegS: null,
        jointGroupCompletion: null,
        engineeringJointSpeedMaxDegS: 100
      },
      {
        requestId: 'move-1', sessionId: 'session-1', status: 'sent', evidence: 'transportWritten',
        normalizedLine: '>1,2,3,4,5,6,10', message: 'written without confirmation', timestampUtc: '2026-08-12T00:00:00.000Z'
      }
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const next = responses.shift();
      if (responses.length === 0) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(resolve, 20);
          init?.signal?.addEventListener('abort', () => {
            window.clearTimeout(timeout);
            reject(new DOMException('aborted', 'AbortError'));
          }, { once: true });
        });
      }
      return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({
      baseUrl: 'http://127.0.0.1:5127', sessionToken: token, requestTimeoutMs: 250
    }, fetcher);

    await gateway.getCapabilities();
    await expect(gateway.sendDirectCommand({
      requestId: 'move-1', sessionId: 'session-1', profileId: 'dummy-6dof',
      line: '>1,2,3,4,5,6,10'
    })).resolves.toMatchObject({ status: 'sent', evidence: 'transportWritten' });
  });

  it('accepts bounded command request evidence and rejects inconsistent audit identities', async () => {
    const result = {
      commandId: 'mode-audit', sessionId: 'session-1', commandKind: 'setMode', status: 'completed',
      code: 'ok', evidence: 'feedbackConfirmed', message: 'mode confirmed', timestampUtc: '2026-08-09T00:00:01.000Z',
      deviceReply: null
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

  it('classifies an empty successful response as invalid gateway JSON instead of a transport outage', async () => {
    const fetcher = vi.fn(async () => new Response('', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.getActionProgramRun()).rejects.toMatchObject({
      status: 502,
      message: '网关响应不是有效 JSON'
    });
  });

  it('restores bounded direct history with queued and terminal write states', async () => {
    const history = [
      {
        requestId: 'direct-1', sessionId: 'session-1', status: 'queued', evidence: 'gatewayAccepted',
        normalizedLine: '#GETMODE', message: 'queued', timestampUtc: '2026-08-13T00:00:00.000Z', deviceReply: null
      },
      {
        requestId: 'direct-2', sessionId: 'session-1', status: 'sent', evidence: 'transportWritten',
        normalizedLine: '#GETENABLE', message: 'written', timestampUtc: '2026-08-13T00:00:01.000Z', deviceReply: null
      }
    ];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(history), { status: 200 })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);

    await expect(gateway.getDirectCommandHistory()).resolves.toEqual(history);
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe('http://127.0.0.1:5127/api/v1/engineering/direct-commands?limit=50');
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

  it('delivers direct command result transitions from SignalR', async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const connection = {
      on: vi.fn((name: string, handler: (value: unknown) => void) => handlers.set(name, handler)),
      onreconnecting: vi.fn(),
      onreconnected: vi.fn(),
      onclose: vi.fn(),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {})
    };
    const gateway = new HttpRobotGateway(
      { baseUrl: 'http://127.0.0.1:5127', sessionToken: token },
      globalThis.fetch.bind(globalThis),
      () => connection as never
    );
    const onDirectCommandResult = vi.fn();
    const close = await gateway.openTelemetry({ onDirectCommandResult });

    handlers.get('directCommandResult')?.({
      requestId: 'direct-1', sessionId: 'session-1', status: 'sent', evidence: 'transportWritten',
      normalizedLine: '#GETMODE', message: 'written', timestampUtc: '2026-08-13T00:00:01.000Z', deviceReply: null
    });
    expect(onDirectCommandResult).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'direct-1', status: 'sent' }));
    await close();
  });

  it('posts immutable action-run snapshots and accepts only unconfirmed runtime states', async () => {
    const starting = {
      contractVersion: '1.0', runId: 'run-1', programId: 'program-1', revision: 2,
      sessionId: 'session-1', profileId: 'dummy-6dof', state: 'starting',
      currentWaypointIndex: null, waypointCount: 1, completedCycles: 0, loopEnabled: true,
      speedDegS: 20, lastRequestId: null, lastEvidence: 'none', physicalCompletionConfirmed: false,
      message: 'starting', startedAtUtc: '2026-08-19T00:00:00.000Z',
      updatedAtUtc: '2026-08-19T00:00:00.000Z', finishedAtUtc: null
    };
    const stopped = {
      ...starting, state: 'stoppedUnconfirmed', lastRequestId: 'run-1-disable',
      lastEvidence: 'transportWritten', message: 'stopped without physical confirmation',
      updatedAtUtc: '2026-08-19T00:00:01.000Z', finishedAtUtc: '2026-08-19T00:00:01.000Z'
    };
    const responses = [starting, stopped];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const gateway = new HttpRobotGateway({ baseUrl: 'http://127.0.0.1:5127', sessionToken: token }, fetcher);
    const request = {
      contractVersion: '1.0' as const,
      runId: 'run-1', programId: 'program-1', revision: 2, sessionId: 'session-1',
      profileId: 'dummy-6dof' as const, source: 'authored' as const, speedDegS: 20, loopEnabled: true,
      waypoints: [{
        waypointId: 'point-1', name: '点位 1', positionsDeg: [181, 95, -45, 200, -150, 900],
        mode: 2 as const, postDispatchWaitMs: 500, source: 'measuredCapture' as const
      }]
    };

    await expect(gateway.startActionProgram(request)).resolves.toMatchObject({ state: 'starting' });
    await expect(gateway.stopActionProgram()).resolves.toMatchObject({ state: 'stoppedUnconfirmed' });
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe('http://127.0.0.1:5127/api/v1/engineering/action-program/run/start');
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body))).toEqual(request);
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe('http://127.0.0.1:5127/api/v1/engineering/action-program/run/stop');
  });

  it('delivers action-run progress from SignalR and rejects false physical completion claims', async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const connection = {
      on: vi.fn((name: string, handler: (value: unknown) => void) => handlers.set(name, handler)),
      onreconnecting: vi.fn(), onreconnected: vi.fn(), onclose: vi.fn(),
      start: vi.fn(async () => {}), stop: vi.fn(async () => {})
    };
    const gateway = new HttpRobotGateway(
      { baseUrl: 'http://127.0.0.1:5127', sessionToken: token },
      globalThis.fetch.bind(globalThis),
      () => connection as never
    );
    const onActionProgramRun = vi.fn();
    const onTransportError = vi.fn();
    const close = await gateway.openTelemetry({ onActionProgramRun, onTransportError });
    const snapshot = {
      contractVersion: '1.0', runId: 'run-1', programId: 'program-1', revision: 2,
      sessionId: 'session-1', profileId: 'dummy-6dof', state: 'running',
      currentWaypointIndex: 0, waypointCount: 1, completedCycles: 0, loopEnabled: false,
      speedDegS: 20, lastRequestId: 'run-1-p0-c0', lastEvidence: 'transportWritten',
      physicalCompletionConfirmed: false, message: 'written, unconfirmed',
      startedAtUtc: '2026-08-19T00:00:00.000Z', updatedAtUtc: '2026-08-19T00:00:01.000Z',
      finishedAtUtc: null
    };

    handlers.get('actionProgramRunSnapshot')?.(snapshot);
    handlers.get('actionProgramRunSnapshot')?.({ ...snapshot, physicalCompletionConfirmed: true });

    expect(onActionProgramRun).toHaveBeenCalledOnce();
    expect(onActionProgramRun).toHaveBeenCalledWith(snapshot);
    expect(onTransportError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'contractViolation' }));
    await close();
  });

  it('accepts an uncorrelated protocol error only when the optional field is omitted', async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const connection = {
      on: vi.fn((name: string, handler: (value: unknown) => void) => handlers.set(name, handler)),
      onreconnecting: vi.fn(),
      onreconnected: vi.fn(),
      onclose: vi.fn(),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {})
    };
    const gateway = new HttpRobotGateway(
      { baseUrl: 'http://127.0.0.1:5127', sessionToken: token },
      globalThis.fetch.bind(globalThis),
      () => connection as never
    );
    const onProtocolFrame = vi.fn();
    const onTransportError = vi.fn();
    const close = await gateway.openTelemetry({ onProtocolFrame, onTransportError });
    const frame = {
      id: 'query-timeout-1', timestampUtc: '2026-08-14T00:00:00.000Z', direction: 'error',
      raw: 'Read-only query timed out: #GETJPOS', parsedKind: 'queryTimeout', source: 'unavailable'
    };

    handlers.get('protocolFrame')?.(frame);
    expect(onProtocolFrame).toHaveBeenCalledWith(frame);
    expect(onTransportError).not.toHaveBeenCalled();

    handlers.get('protocolFrame')?.({ ...frame, correlationId: null });
    expect(onTransportError).toHaveBeenCalledWith({
      kind: 'contractViolation',
      message: expect.stringContaining('RobotGatewayV1')
    });
    await close();
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
      capabilities: {
        available: true, minimize: true, toggleMaximize: true, close: true, exportDiagnostics: true
      }
    })).toBeInstanceOf(HttpRobotGateway);
  });

  it('treats the desktop bootstrap as authoritative over development environment values', () => {
    expect(resolveRobotGatewayConfig({
      VITE_AETHOR_GATEWAY_URL: 'http://127.0.0.1:5127',
      VITE_AETHOR_GATEWAY_SESSION_TOKEN: token
    }, {
      contractVersion: '1.0', gateway: { baseUrl: 'http://127.0.0.1:64050', sessionToken: 'B'.repeat(32) },
      capabilities: {
        available: true, minimize: true, toggleMaximize: true, close: true, exportDiagnostics: true
      }
    })).toEqual({ baseUrl: 'http://127.0.0.1:64050', sessionToken: 'B'.repeat(32) });

    expect(createRobotGateway({
      VITE_AETHOR_GATEWAY_URL: 'http://127.0.0.1:5127',
      VITE_AETHOR_GATEWAY_SESSION_TOKEN: token
    }, {
      contractVersion: '1.0', gateway: null,
      capabilities: {
        available: true, minimize: true, toggleMaximize: true, close: true, exportDiagnostics: true
      }
    })).toBeInstanceOf(StaticShowcaseSource);
  });
});
