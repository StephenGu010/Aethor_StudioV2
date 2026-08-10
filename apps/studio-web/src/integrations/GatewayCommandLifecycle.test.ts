import type { CommandAuditRecord, CommandResult, RobotSessionSnapshot } from '@aethor/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showcaseJointFrame } from '../fixtures/showcase';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import type { RobotGatewayV1 as GatewayPort } from './robotGateway';
import { runGatewayCommandLifecycle } from './GatewayCommandLifecycle';

describe('gateway command lifecycle', () => {
  beforeEach(() => useGatewayRuntimeStore.getState().resetRuntime());

  it('turns a lost command response into a latched unconfirmed result', async () => {
    const { gateway, getCommandHistory, getSession } = fakeGateway();
    useGatewayRuntimeStore.getState().setSession(connectedSession);

    const outcome = await runGatewayCommandLifecycle({
      gateway,
      intent: { commandId: 'stop-unknown', sessionId: 'session-1', commandKind: 'stopAndDisable' },
      operationLabel: '停止并去使能',
      execute: async () => { throw new Error('loopback response lost'); }
    });

    expect(outcome.result).toMatchObject({ status: 'unconfirmed', code: 'transportError', evidence: 'none' });
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      lastCommandResult: { commandId: 'stop-unknown' },
      latchedSafetyResult: { commandId: 'stop-unknown' },
      commandAuditStatus: 'error'
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(getCommandHistory).not.toHaveBeenCalled();
  });

  it('reconciles a terminal result with authoritative session, feedback, and audit', async () => {
    useGatewayRuntimeStore.getState().setSession(connectedSession);
    useGatewayRuntimeStore.getState().setLastCommandResult(result('move-unknown', 'jointGroup', 'unconfirmed', '2026-08-09T00:00:01.000Z'));
    const stopResult = result('stop-1', 'stopAndDisable', 'completed', '2026-08-09T00:00:02.000Z');
    const stoppedSession = { ...connectedSession, motorState: 'disabled' as const, timestampUtc: stopResult.timestampUtc };
    const history = [audit(stopResult)];
    const { gateway } = fakeGateway({ session: stoppedSession, history });

    const outcome = await runGatewayCommandLifecycle({
      gateway,
      intent: { commandId: 'stop-1', sessionId: 'session-1', commandKind: 'stopAndDisable' },
      operationLabel: '停止并去使能',
      execute: async () => stopResult
    });

    expect(outcome).toMatchObject({ transportError: null, snapshotError: null, auditError: null });
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      session: { motorState: 'disabled' },
      commandAuditStatus: 'ready',
      commandHistory: [{ commandId: 'stop-1' }],
      lastCommandResult: { commandId: 'stop-1' },
      latchedSafetyResult: null
    });
  });
});

const connectedSession: RobotSessionSnapshot = {
  sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
  controlMode: 2, timestampUtc: '2026-08-09T00:00:00.000Z', source: 'measured', validity: 'valid'
};

function fakeGateway({
  session = connectedSession,
  history = []
}: {
  session?: RobotSessionSnapshot;
  history?: CommandAuditRecord[];
} = {}) {
  const getSession = vi.fn(async () => session);
  const getCommandHistory = vi.fn(async () => history);
  const gateway: GatewayPort = {
    capabilities: {
      source: 'gateway' as const, serialEnumeration: true, readOnlyConnection: true, hardwareCommands: true,
      rawCommand: false, liveTelemetry: true, commandPolicy: 'supervised' as const,
      supportedCommands: ['enable', 'stopAndDisable', 'setMode'],
      jointGroupSpeedLimitDegS: null, jointGroupCompletion: null, engineeringJointSpeedMaxDegS: null
    },
    getCapabilities: vi.fn(async () => null),
    listSerialPorts: vi.fn(async () => []),
    connect: vi.fn(async () => session),
    disconnect: vi.fn(async () => session),
    openTelemetry: vi.fn(async () => async () => {}),
    getSession,
    getJointState: vi.fn(async () => ({ ...showcaseJointFrame, source: 'measured' as const, validity: 'valid' as const })),
    getProtocolFrames: vi.fn(async () => []),
    getCommandHistory,
    enable: vi.fn(), stopAndDisable: vi.fn(), home: vi.fn(), reset: vi.fn(), setMode: vi.fn(), sendJointGroup: vi.fn(), sendDirectCommand: vi.fn()
  };
  return { gateway, getSession, getCommandHistory };
}

function result(
  commandId: string,
  commandKind: CommandResult['commandKind'],
  status: CommandResult['status'],
  timestampUtc: string
): CommandResult {
  return {
    commandId, sessionId: 'session-1', commandKind, status,
    code: status === 'completed' ? 'ok' : 'deviceUnconfirmed',
    evidence: status === 'completed' ? 'feedbackConfirmed' : 'none',
    message: status, timestampUtc
  };
}

function audit(resultValue: CommandResult): CommandAuditRecord {
  return {
    commandId: resultValue.commandId,
    sessionId: resultValue.sessionId,
    profileId: 'dummy-6dof',
    commandKind: resultValue.commandKind,
    acceptedAtUtc: resultValue.timestampUtc,
    request: {
      commandKind: resultValue.commandKind,
      requestFingerprintSha256: '0'.repeat(64),
      mode: null,
      positionsDeg: null,
      positionsCount: null,
      speedDegS: null,
      payloadTruncated: false
    },
    transmittedPayloads: ['!STOP', '$0,0,0,0,0,0', '!DISABLE', '#GETENABLE'],
    transmissionLogTruncated: false,
    result: resultValue
  };
}
