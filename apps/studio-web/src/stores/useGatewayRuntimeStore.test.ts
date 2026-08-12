import type { CommandAuditRecord, ProtocolFrame, RobotGatewayCapabilitiesV1 } from '@aethor/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import { useRobotSessionStore } from './useRobotSessionStore';
import { useGatewayRuntimeStore } from './useGatewayRuntimeStore';

describe('gateway runtime store', () => {
  beforeEach(() => useGatewayRuntimeStore.getState().resetRuntime());

  it('bounds protocol evidence and retains the newest frames', () => {
    for (let index = 0; index < 300; index += 1) {
      useGatewayRuntimeStore.getState().appendProtocolFrame(frame(index));
    }

    const frames = useGatewayRuntimeStore.getState().protocolFrames;
    expect(frames).toHaveLength(256);
    expect(frames[0]?.id).toBe('frame-44');
    expect(frames.at(-1)?.id).toBe('frame-299');
  });

  it('deduplicates protocol evidence by stable frame id', () => {
    useGatewayRuntimeStore.getState().appendProtocolFrame(frame(1));
    useGatewayRuntimeStore.getState().appendProtocolFrame(frame(1));
    useGatewayRuntimeStore.getState().replaceProtocolFrames([frame(1), frame(2), frame(1)]);

    expect(useGatewayRuntimeStore.getState().protocolFrames.map((item) => item.id)).toEqual([
      'frame-2', 'frame-1'
    ]);
  });

  it('keeps routine joint polling out of the operator event stream without dropping raw evidence', () => {
    const jointQuery = { ...frame(1), direction: 'tx' as const, raw: '#GETJPOS', parsedKind: 'query' };
    const jointReply = { ...frame(2), direction: 'rx' as const, raw: 'ok 1 2 3 4 5 6', parsedKind: 'jointPositions' };
    const modeReply = { ...frame(3), direction: 'rx' as const, raw: 'ok 2 INT_POINT', parsedKind: 'mode' };

    useGatewayRuntimeStore.getState().replaceProtocolFrames([jointQuery, jointReply, modeReply]);

    expect(useGatewayRuntimeStore.getState().protocolFrames).toHaveLength(3);
    expect(useGatewayRuntimeStore.getState().operatorProtocolFrames).toEqual([modeReply]);
  });

  it('keeps the operator event view within the same 256-frame raw evidence window', () => {
    const oldOperatorFrame = { ...frame(0), direction: 'rx' as const, parsedKind: 'mode' };
    useGatewayRuntimeStore.getState().appendProtocolFrame(oldOperatorFrame);
    for (let index = 1; index <= 256; index += 1) {
      useGatewayRuntimeStore.getState().appendProtocolFrame({
        ...frame(index), direction: 'tx', raw: '#GETJPOS', parsedKind: 'query'
      });
    }

    expect(useGatewayRuntimeStore.getState().protocolFrames).toHaveLength(256);
    expect(useGatewayRuntimeStore.getState().operatorProtocolFrames).toEqual([]);
  });

  it('resets to showcase without claiming a hardware session', () => {
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });

    useGatewayRuntimeStore.getState().resetRuntime();

    expect(useGatewayRuntimeStore.getState().session).toMatchObject({
      connectionState: 'offline', motorState: 'unknown', source: 'showcase'
    });
  });

  it('completes disconnect like a fresh app session while preserving negotiated capabilities', () => {
    const capabilities = gatewayCapabilities();
    useGatewayRuntimeStore.getState().setCapabilities(capabilities);
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    useGatewayRuntimeStore.getState().setJointState({
      sequence: 3, profileId: 'dummy-6dof', timestampUtc: '2026-08-09T00:00:00.000Z',
      positionsDeg: [1, 2, 3, 4, 5, 6], source: 'measured', validity: 'valid'
    });
    useGatewayRuntimeStore.getState().appendProtocolFrame(frame(1));
    useRobotSessionStore.getState().setJointTarget(1, 30);

    useGatewayRuntimeStore.getState().completeDisconnect({
      sessionId: 'offline', profileId: 'dummy-6dof', connectionState: 'offline', motorState: 'unknown',
      controlMode: null, timestampUtc: '2026-08-09T00:00:01.000Z', source: 'unavailable', validity: 'unavailable'
    });

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      capabilities,
      session: { sessionId: 'offline', connectionState: 'offline' },
      jointState: { source: 'showcase' },
      protocolFrames: [],
      commandHistory: [],
      transportWarning: null,
      activePortName: null
    });
    expect(useRobotSessionStore.getState().targetPositionsDeg).toEqual(dummyProfile.model.showcasePoseDeg);
  });

  it('downgrades valid measured telemetry without discarding the last known values', () => {
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    useGatewayRuntimeStore.getState().setJointState({
      sequence: 7, profileId: 'dummy-6dof', timestampUtc: '2026-08-09T00:00:00.000Z',
      positionsDeg: [12, 23, 34, 45, 56, 67], source: 'measured', validity: 'valid'
    });

    useGatewayRuntimeStore.getState().markTelemetryDegraded('SignalR disconnected');

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: 'SignalR disconnected',
      session: { sessionId: 'session-1', connectionState: 'connected', motorState: 'enabled', validity: 'stale' },
      jointState: { sequence: 7, positionsDeg: [12, 23, 34, 45, 56, 67], validity: 'stale' }
    });
  });

  it('bounds REST command audit evidence and retains the newest records', () => {
    useGatewayRuntimeStore.getState().replaceCommandHistory(
      Array.from({ length: 160 }, (_, index) => audit(index))
    );

    const history = useGatewayRuntimeStore.getState().commandHistory;
    expect(history).toHaveLength(128);
    expect(history[0]?.commandId).toBe('command-32');
    expect(history.at(-1)?.commandId).toBe('command-159');
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      commandAuditStatus: 'ready',
      commandAuditError: null
    });
  });

  it('tracks command audit recovery independently from transport state', () => {
    useGatewayRuntimeStore.getState().beginCommandAuditRefresh();
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      commandAuditStatus: 'loading',
      commandAuditError: null
    });

    useGatewayRuntimeStore.getState().failCommandAuditRefresh('REST history unavailable');
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      commandAuditStatus: 'error',
      commandAuditError: 'REST history unavailable'
    });

    useGatewayRuntimeStore.getState().replaceCommandHistory([]);
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      commandAuditStatus: 'ready',
      commandAuditError: null,
      commandHistory: []
    });
  });

  it('publishes one shared serial session operation state and resets it with the session', () => {
    useGatewayRuntimeStore.getState().beginSerialSessionOperation('connecting');
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialSessionOperationStatus: 'connecting',
      serialSessionOperationError: null
    });

    useGatewayRuntimeStore.getState().failSerialSessionOperation('connection conflict');
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialSessionOperationStatus: 'error',
      serialSessionOperationError: 'connection conflict'
    });

    useGatewayRuntimeStore.getState().resetRuntime();
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      serialSessionOperationStatus: 'idle',
      serialSessionOperationError: null
    });
  });

  it('restores safety interlocks from history and only clears them with a confirmed later stop', () => {
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    const uncertain = auditForSession('move-1', 'jointGroup', 'unconfirmed', '2026-08-09T00:00:01.000Z');
    useGatewayRuntimeStore.getState().replaceCommandHistory([uncertain]);
    expect(useGatewayRuntimeStore.getState().latchedSafetyResult?.commandId).toBe('move-1');

    useGatewayRuntimeStore.getState().replaceCommandHistory([]);
    expect(useGatewayRuntimeStore.getState().latchedSafetyResult?.commandId).toBe('move-1');

    const stop = auditForSession('stop-1', 'stopAndDisable', 'completed', '2026-08-09T00:00:02.000Z');
    useGatewayRuntimeStore.getState().replaceCommandHistory([uncertain, stop]);
    expect(useGatewayRuntimeStore.getState().latchedSafetyResult).toBeNull();
  });

  it('does not let an older uncertain terminal event overwrite a newer confirmed stop', () => {
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    const uncertain = auditForSession('move-1', 'jointGroup', 'unconfirmed', '2026-08-09T00:00:01.000Z').result;
    const stopped = auditForSession('stop-1', 'stopAndDisable', 'completed', '2026-08-09T00:00:02.000Z').result;

    useGatewayRuntimeStore.getState().setLastCommandResult(uncertain);
    useGatewayRuntimeStore.getState().setLastCommandResult(stopped);
    useGatewayRuntimeStore.getState().setLastCommandResult(uncertain);

    expect(useGatewayRuntimeStore.getState().lastCommandResult?.commandId).toBe('stop-1');
    expect(useGatewayRuntimeStore.getState().latchedSafetyResult).toBeNull();
  });

  it('retains the confirmed-stop watermark restored from history', () => {
    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
      controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
    });
    const stopped = auditForSession('stop-1', 'stopAndDisable', 'completed', '2026-08-09T00:00:02.000Z');
    const olderUncertain = auditForSession('move-1', 'jointGroup', 'unconfirmed', '2026-08-09T00:00:01.000Z').result;

    useGatewayRuntimeStore.getState().replaceCommandHistory([stopped]);
    useGatewayRuntimeStore.getState().replaceCommandHistory([]);
    useGatewayRuntimeStore.getState().setLastCommandResult(olderUncertain);

    expect(useGatewayRuntimeStore.getState().latchedSafetyResult).toBeNull();
  });

  it('clears command and protocol evidence when the device session identity changes', () => {
    useGatewayRuntimeStore.getState().setLastCommandResult({
      commandId: 'cmd-1', sessionId: 'offline', commandKind: 'jointGroup', status: 'unconfirmed',
      code: 'deviceUnconfirmed', evidence: 'deviceQueued', message: 'unknown',
      timestampUtc: '2026-08-09T00:00:00.000Z'
    });
    useGatewayRuntimeStore.getState().appendProtocolFrame(frame(1));
    useGatewayRuntimeStore.getState().replaceCommandHistory([audit(1)]);

    useGatewayRuntimeStore.getState().setSession({
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'unknown',
      controlMode: null, timestampUtc: '2026-08-09T00:00:01.000Z', source: 'measured', validity: 'stale'
    });

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      lastCommandResult: null,
      latchedSafetyResult: null,
      protocolFrames: [],
      commandHistory: [],
      commandAuditStatus: 'unavailable',
      commandAuditError: null
    });
    useGatewayRuntimeStore.getState().setLastCommandResult({
      commandId: 'late', sessionId: 'offline', commandKind: 'enable', status: 'completed',
      code: 'ok', evidence: 'feedbackConfirmed', message: 'late', timestampUtc: '2026-08-09T00:00:02.000Z'
    });
    expect(useGatewayRuntimeStore.getState().lastCommandResult).toBeNull();
  });
});

function auditForSession(
  commandId: string,
  commandKind: CommandAuditRecord['commandKind'],
  status: CommandAuditRecord['result']['status'],
  timestampUtc: string
): CommandAuditRecord {
  return {
    ...audit(0),
    commandId,
    sessionId: 'session-1',
    commandKind,
    acceptedAtUtc: timestampUtc,
    request: {
      ...audit(0).request,
      commandKind
    },
    result: {
      commandId,
      sessionId: 'session-1',
      commandKind,
      status,
      code: status === 'completed' ? 'ok' : 'deviceUnconfirmed',
      evidence: status === 'completed' ? 'feedbackConfirmed' : 'deviceQueued',
      message: status,
      timestampUtc
    }
  };
}

function audit(index: number): CommandAuditRecord {
  const commandId = `command-${index}`;
  return {
    commandId,
    sessionId: 'offline',
    profileId: 'dummy-6dof',
    commandKind: 'enable',
    acceptedAtUtc: '2026-08-09T00:00:00.000Z',
    request: {
      commandKind: 'enable',
      requestFingerprintSha256: index.toString(16).padStart(64, '0'),
      mode: null,
      positionsDeg: null,
      positionsCount: null,
      speedDegS: null,
      payloadTruncated: false
    },
    transmittedPayloads: ['!START', '#GETENABLE'],
    transmissionLogTruncated: false,
    result: {
      commandId,
      sessionId: 'offline',
      commandKind: 'enable',
      status: 'completed',
      code: 'ok',
      evidence: 'feedbackConfirmed',
      message: 'confirmed',
      timestampUtc: '2026-08-09T00:00:00.000Z'
    }
  };
}

function frame(index: number): ProtocolFrame {
  return {
    id: `frame-${index}`,
    timestampUtc: '2026-08-09T00:00:00.000Z',
    direction: 'rx',
    raw: `ok ${index}`,
    parsedKind: 'test',
    source: 'measured'
  };
}

function gatewayCapabilities(): RobotGatewayCapabilitiesV1 {
  return {
    contractVersion: '1.3',
    protocolAdapterId: 'dummy-ascii-v1',
    serialEnumeration: true,
    readOnlyConnection: true,
    liveTelemetry: true,
    hardwareCommands: true,
    directCommand: true,
    commandPolicy: 'engineering',
    allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
    supportedCommands: ['enable', 'stopAndDisable', 'setMode'],
    jointGroupSpeedLimitDegS: null,
    jointGroupCompletion: null,
    engineeringJointSpeedMaxDegS: 100
  };
}
