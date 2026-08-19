import type { CommandAuditRecord, CommandResult } from '@aethor/contracts';
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileLatchedSafetyResult } from '../domain/commandSafety';
import { showcaseJointFrame } from '../fixtures/showcase';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../stores/useRobotSessionStore';
import type { RobotGatewayTelemetryListener, RobotGatewayV1 } from './robotGateway';
import { GatewaySessionCoordinator } from './GatewaySessionCoordinator';

describe('GatewaySessionCoordinator safety recovery', () => {
  beforeEach(() => {
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
  });

  it('restores an uncertain interlock across page reload until a confirmed stop clears it', () => {
    const uncertain = result('move-1', 'jointGroup', 'unconfirmed');
    const rejected = result('move-2', 'jointGroup', 'rejected');
    const history = [audit(uncertain), audit(rejected)];

    expect(reconcileLatchedSafetyResult(history, 'session-1', null)).toEqual(rejected);

    const stopped = result('stop-1', 'stopAndDisable', 'completed');
    expect(reconcileLatchedSafetyResult([...history, audit(stopped)], 'session-1', uncertain)).toBeNull();
    expect(reconcileLatchedSafetyResult(history, 'different-session', null)).toBeNull();
  });

  it('recovers bounded command audits initially and after a SignalR terminal notification', async () => {
    const session = {
      sessionId: 'session-1', profileId: 'dummy-6dof' as const, connectionState: 'connected' as const,
      motorState: 'disabled' as const, controlMode: 2 as const, timestampUtc: '2026-08-09T00:00:00.000Z',
      source: 'measured' as const, validity: 'valid' as const
    };
    let telemetryListener: RobotGatewayTelemetryListener | undefined;
    let history = [audit(result('mode-1', 'setMode', 'completed'))];
    const getCommandHistory = vi.fn(async () => history);
    const closeTelemetry = vi.fn(async () => {});
    const gateway = coordinatorGateway(session, {
      getCommandHistory,
      openTelemetry: async (listener) => {
        telemetryListener = listener;
        return closeTelemetry;
      }
    });

    const rendered = render(createElement(GatewaySessionCoordinator, { gateway }));
    await waitFor(() => expect(useGatewayRuntimeStore.getState().commandHistory).toHaveLength(1));
    expect(useGatewayRuntimeStore.getState().commandAuditStatus).toBe('ready');

    const stop = result('stop-1', 'stopAndDisable', 'completed');
    history = [...history, audit(stop)];
    act(() => telemetryListener?.onCommandResult?.(stop));

    await waitFor(() => expect(getCommandHistory).toHaveBeenCalledTimes(2));
    expect(useGatewayRuntimeStore.getState().commandHistory.at(-1)?.commandId).toBe('stop-1');

    history = [];
    act(() => telemetryListener?.onSession?.({ ...session, sessionId: 'session-2' }));
    await waitFor(() => expect(getCommandHistory).toHaveBeenCalledTimes(3));
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      session: { sessionId: 'session-2' },
      commandAuditStatus: 'ready',
      commandHistory: []
    });

    rendered.unmount();
    await waitFor(() => expect(closeTelemetry).toHaveBeenCalledOnce());
  });

  it('restores direct history and applies SignalR terminal transitions by request id', async () => {
    let telemetryListener: RobotGatewayTelemetryListener | undefined;
    const queued = {
      requestId: 'direct-1', sessionId: 'session-1', status: 'queued' as const,
      evidence: 'gatewayAccepted' as const, normalizedLine: '#GETMODE', message: 'queued',
      timestampUtc: '2026-08-13T00:00:00.000Z'
    };
    const gateway = coordinatorGateway(coordinatorSession(), {
      getDirectCommandHistory: async () => [queued],
      openTelemetry: async (listener) => {
        telemetryListener = listener;
        return async () => {};
      }
    });

    const rendered = render(createElement(GatewaySessionCoordinator, { gateway }));
    await waitFor(() => expect(useGatewayRuntimeStore.getState().directCommandHistory).toEqual([queued]));
    act(() => telemetryListener?.onDirectCommandResult?.({
      ...queued,
      status: 'sent',
      evidence: 'transportWritten',
      message: 'written',
      timestampUtc: '2026-08-13T00:00:01.000Z'
    }));

    expect(useGatewayRuntimeStore.getState().directCommandHistory).toMatchObject([
      { requestId: 'direct-1', status: 'sent', evidence: 'transportWritten' }
    ]);
    rendered.unmount();
  });

  it('keeps telemetry alive but marks command authority unsafe when audit recovery fails', async () => {
    const session = {
      sessionId: 'session-1', profileId: 'dummy-6dof' as const, connectionState: 'connected' as const,
      motorState: 'disabled' as const, controlMode: 2 as const, timestampUtc: '2026-08-09T00:00:00.000Z',
      source: 'measured' as const, validity: 'valid' as const
    };
    const closeTelemetry = vi.fn(async () => {});
    const openTelemetry = vi.fn(async () => closeTelemetry);
    const gateway = coordinatorGateway(session, {
      getCommandHistory: async () => { throw new Error('audit endpoint unavailable'); },
      openTelemetry
    });

    const rendered = render(createElement(GatewaySessionCoordinator, { gateway }));

    await waitFor(() => expect(useGatewayRuntimeStore.getState().commandAuditStatus).toBe('error'));
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      capabilities: { contractVersion: '1.4' },
      session: { sessionId: 'session-1', connectionState: 'connected' },
      commandAuditError: 'audit endpoint unavailable'
    });
    expect(openTelemetry).toHaveBeenCalledOnce();

    rendered.unmount();
    await waitFor(() => expect(closeTelemetry).toHaveBeenCalledOnce());
  });

  it('recovers from an initial authority read failure without reloading the application', async () => {
    const session = coordinatorSession();
    let actionRunReadCount = 0;
    const getActionProgramRun = vi.fn(async () => {
      actionRunReadCount += 1;
      if (actionRunReadCount === 1) throw new Error('temporary action snapshot outage');
      return null;
    });
    const openTelemetry = vi.fn(async () => async () => {});
    const gateway = coordinatorGateway(session, { getActionProgramRun, openTelemetry });

    const rendered = render(createElement(GatewaySessionCoordinator, { gateway }));

    await waitFor(() => expect(openTelemetry).toHaveBeenCalledOnce());
    expect(getActionProgramRun).toHaveBeenCalledTimes(2);
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: null,
      session: { sessionId: session.sessionId, connectionState: 'connected' }
    });
    rendered.unmount();
  });

  it('aligns the target draft once from the first trusted measured frame of a hardware session', async () => {
    const session = coordinatorSession();
    const measured = {
      ...showcaseJointFrame,
      sequence: 9,
      positionsDeg: [10, 20, 30, 40, 50, 60],
      source: 'measured' as const,
      validity: 'valid' as const
    };
    const rendered = render(createElement(GatewaySessionCoordinator, {
      gateway: coordinatorGateway(session, { getJointState: async () => measured })
    }));

    await waitFor(() => expect(useRobotSessionStore.getState()).toMatchObject({
      hardwareSessionId: session.sessionId,
      measuredAlignmentPending: false,
      targetPositionsDeg: measured.positionsDeg
    }));
    rendered.unmount();
  });

  it('marks measured telemetry stale on transport loss and clears degradation only after a live joint event', async () => {
    let session = coordinatorSession();
    let jointState = {
      ...showcaseJointFrame,
      sequence: 7,
      positionsDeg: [12, 23, 34, 45, 56, 67],
      source: 'measured' as const,
      validity: 'valid' as const
    };
    let telemetryListener: RobotGatewayTelemetryListener | undefined;
    const getSession = vi.fn(async () => session);
    const getJointState = vi.fn(async () => jointState);
    const gateway = coordinatorGateway(session, {
      getSession,
      getJointState,
      openTelemetry: async (listener) => {
        telemetryListener = listener;
        return async () => {};
      }
    });

    const rendered = render(createElement(GatewaySessionCoordinator, { gateway }));
    await waitFor(() => expect(telemetryListener).toBeDefined());
    expect(useGatewayRuntimeStore.getState().jointState.validity).toBe('valid');

    act(() => telemetryListener?.onTransportError?.({ kind: 'reconnecting', message: 'SignalR reconnecting' }));
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: 'SignalR reconnecting',
      session: { validity: 'stale' },
      jointState: { validity: 'stale', positionsDeg: [12, 23, 34, 45, 56, 67] }
    });

    session = { ...session, timestampUtc: '2026-08-09T00:00:02.000Z' };
    jointState = {
      ...jointState,
      sequence: 8,
      positionsDeg: [13, 24, 35, 46, 57, 68],
      timestampUtc: '2026-08-09T00:00:02.000Z'
    };
    act(() => telemetryListener?.onTransportRecovered?.());

    await waitFor(() => expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: '实时关节事件已停滞；当前以 REST 权威快照降级刷新',
      session: { validity: 'valid', timestampUtc: '2026-08-09T00:00:02.000Z' },
      jointState: { validity: 'valid', sequence: 8, positionsDeg: [13, 24, 35, 46, 57, 68] }
    }));
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getJointState).toHaveBeenCalledTimes(2);

    act(() => telemetryListener?.onTransportError?.({
      kind: 'contractViolation',
      message: 'malformed telemetry frame'
    }));
    expect(useGatewayRuntimeStore.getState().jointState.validity).toBe('stale');
    await waitFor(() => expect(useGatewayRuntimeStore.getState().jointState.validity).toBe('valid'));
    expect(getSession).toHaveBeenCalledTimes(3);
    expect(getJointState).toHaveBeenCalledTimes(3);

    act(() => telemetryListener?.onJointState?.({ ...jointState, sequence: 9 }));
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: null,
      jointState: { sequence: 9, validity: 'valid' }
    });
    rendered.unmount();
  });

  it('starts bounded REST fallback when the live channel cannot open', async () => {
    const session = coordinatorSession();
    const getSession = vi.fn(async () => session);
    const getJointState = vi.fn(async () => ({
      ...showcaseJointFrame,
      sequence: 4,
      timestampUtc: new Date(Date.now()).toISOString(),
      source: 'measured' as const,
      validity: 'valid' as const
    }));
    const gateway = coordinatorGateway(session, {
      getSession,
      getJointState,
      openTelemetry: async () => { throw new Error('SignalR unavailable'); }
    });

    const rendered = render(createElement(GatewaySessionCoordinator, {
      gateway,
      telemetryStallThresholdMs: 30,
      telemetryFallbackIntervalMs: 30
    }));
    await waitFor(() => expect(getJointState.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: '实时关节事件已停滞；当前以 REST 权威快照降级刷新',
      jointState: { sequence: 4, source: 'measured', validity: 'valid' }
    });
    rendered.unmount();
  });

  it('stops fallback and clears its warning when the hardware session goes offline', async () => {
    const session = coordinatorSession();
    let telemetryListener: RobotGatewayTelemetryListener | undefined;
    const gateway = coordinatorGateway(session, {
      openTelemetry: async (listener) => {
        telemetryListener = listener;
        return async () => {};
      }
    });
    const rendered = render(createElement(GatewaySessionCoordinator, {
      gateway,
      telemetryStallThresholdMs: 30,
      telemetryFallbackIntervalMs: 30
    }));
    await waitFor(() => expect(useGatewayRuntimeStore.getState().transportWarning).not.toBeNull());

    act(() => telemetryListener?.onSession?.({
      ...session,
      sessionId: 'offline',
      connectionState: 'offline',
      motorState: 'unknown',
      controlMode: null,
      source: 'unavailable',
      validity: 'unavailable'
    }));

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: null,
      session: { connectionState: 'offline', validity: 'unavailable' }
    });
    rendered.unmount();
  });

  it('falls back to bounded REST snapshots when live joint events silently stall and recovers on the next event', async () => {
    const session = coordinatorSession();
    let jointSequence = 10;
    let telemetryListener: RobotGatewayTelemetryListener | undefined;
    const getSession = vi.fn(async () => ({
      ...session,
      timestampUtc: new Date(Date.now()).toISOString()
    }));
    const getJointState = vi.fn(async () => ({
      ...showcaseJointFrame,
      sequence: jointSequence++,
      timestampUtc: new Date(Date.now()).toISOString(),
      positionsDeg: [jointSequence, 20, 30, 40, 50, 60],
      source: 'measured' as const,
      validity: 'valid' as const
    }));
    const gateway = coordinatorGateway(session, {
      getSession,
      getJointState,
      openTelemetry: async (listener) => {
        telemetryListener = listener;
        return async () => {};
      }
    });

    const rendered = render(createElement(GatewaySessionCoordinator, {
      gateway,
      telemetryStallThresholdMs: 30,
      telemetryFallbackIntervalMs: 30
    }));
    await waitFor(() => expect(telemetryListener).toBeDefined());
    await waitFor(() => expect(getJointState.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: '实时关节事件已停滞；当前以 REST 权威快照降级刷新',
      jointState: { source: 'measured', validity: 'valid' }
    });

    act(() => telemetryListener?.onJointState?.({
      ...showcaseJointFrame,
      sequence: 99,
      timestampUtc: new Date(Date.now()).toISOString(),
      positionsDeg: [1, 2, 3, 4, 5, 6],
      source: 'measured',
      validity: 'valid'
    }));

    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      transportWarning: null,
      jointState: { sequence: 99, positionsDeg: [1, 2, 3, 4, 5, 6], validity: 'valid' }
    });
    rendered.unmount();
  });
});

function coordinatorGateway(
  session: ReturnType<typeof coordinatorSession>,
  overrides: Partial<RobotGatewayV1> = {}
): RobotGatewayV1 {
  const gateway: RobotGatewayV1 = {
    capabilities: {
      source: 'gateway', serialEnumeration: true, readOnlyConnection: true, hardwareCommands: false,
      rawCommand: false, liveTelemetry: true, commandPolicy: 'disabled', supportedCommands: [],
      jointGroupSpeedLimitDegS: null, jointGroupCompletion: null, engineeringJointSpeedMaxDegS: null
    },
    getCapabilities: async () => ({
      contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: false, directCommand: false, commandPolicy: 'disabled',
      allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'], supportedCommands: [],
      jointGroupSpeedLimitDegS: null, jointGroupCompletion: null, engineeringJointSpeedMaxDegS: null
    }),
    getSession: async () => session,
    getJointState: async () => ({ ...showcaseJointFrame, sequence: 1, source: 'measured', validity: 'valid' }),
    getProtocolFrames: async () => [],
    getCommandHistory: overrides.getCommandHistory ?? (async () => []),
    getDirectCommandHistory: async () => [],
    getActionProgramRun: async () => null,
    listSerialPorts: async () => [],
    connect: async () => session,
    disconnect: async () => session,
    enable: async () => { throw new Error('not used'); },
    stopAndDisable: async () => { throw new Error('not used'); },
    home: async () => { throw new Error('not used'); },
    reset: async () => { throw new Error('not used'); },
    setMode: async () => { throw new Error('not used'); },
    sendJointGroup: async () => { throw new Error('not used'); },
    sendDirectCommand: async () => { throw new Error('not used'); },
    startActionProgram: async () => { throw new Error('not used'); },
    stopActionProgram: async () => { throw new Error('not used'); },
    openTelemetry: async () => async () => {}
  };
  return { ...gateway, ...overrides };
}

function coordinatorSession() {
  return {
    sessionId: 'session-1', profileId: 'dummy-6dof' as const, connectionState: 'connected' as const,
    motorState: 'disabled' as const, controlMode: 2 as const, timestampUtc: '2026-08-09T00:00:00.000Z',
    source: 'measured' as const, validity: 'valid' as const
  };
}

function result(commandId: string, commandKind: CommandResult['commandKind'], status: CommandResult['status']): CommandResult {
  return {
    commandId, sessionId: 'session-1', commandKind, status,
    code: status === 'completed' ? 'ok' : status === 'rejected' ? 'safetyInterlockLatched' : 'deviceUnconfirmed',
    evidence: status === 'completed' ? 'feedbackConfirmed' : 'none',
    message: status, timestampUtc: '2026-08-09T00:00:00.000Z'
  };
}

function audit(resultValue: CommandResult): CommandAuditRecord {
  const isMode = resultValue.commandKind === 'setMode';
  const isJointGroup = resultValue.commandKind === 'jointGroup';
  return {
    commandId: resultValue.commandId,
    sessionId: resultValue.sessionId,
    profileId: 'dummy-6dof',
    commandKind: resultValue.commandKind,
    acceptedAtUtc: resultValue.timestampUtc,
    request: {
      commandKind: resultValue.commandKind,
      requestFingerprintSha256: '0'.repeat(64),
      mode: isMode ? 2 : null,
      positionsDeg: isJointGroup ? [0, 0, 0, 0, 0, 0] : null,
      positionsCount: isJointGroup ? 6 : null,
      speedDegS: isJointGroup ? 10 : null,
      payloadTruncated: false
    },
    transmittedPayloads: [],
    transmissionLogTruncated: false,
    result: resultValue
  };
}
