import { describe, expect, it } from 'vitest';
import { createCommandLifecycle, toCommandResult, transitionCommand } from '../src/commandStateMachine';
import { createOfflineSession, transitionSession } from '../src/sessionStateMachine';

const time = (second: number) => `2026-08-08T00:00:${String(second).padStart(2, '0')}.000Z`;

describe('command lifecycle', () => {
  it('does not promote device queue or ACK evidence to physical completion', () => {
    let state = createCommandLifecycle('cmd-1', time(0));
    state = transitionCommand(state, { type: 'gatewayAccepted', timestampUtc: time(1) }).state;
    state = transitionCommand(state, { type: 'deviceQueued', timestampUtc: time(2) }).state;
    state = transitionCommand(state, { type: 'deviceAck', timestampUtc: time(3) }).state;
    expect(state).toMatchObject({ status: 'accepted', evidence: 'deviceAck' });
    state = transitionCommand(state, { type: 'completionConfirmed', timestampUtc: time(4) }).state;
    expect(state).toMatchObject({ status: 'completed', evidence: 'feedbackConfirmed' });
  });

  it('represents missing physical confirmation and freezes terminal outcomes', () => {
    let state = createCommandLifecycle('cmd-2', time(0));
    state = transitionCommand(state, { type: 'gatewayAccepted', timestampUtc: time(1) }).state;
    state = transitionCommand(state, { type: 'deviceAck', timestampUtc: time(2) }).state;
    state = transitionCommand(state, { type: 'confirmationUnavailable', timestampUtc: time(3) }).state;
    expect(toCommandResult(state, '位置未确认', 'ok')).toMatchObject({ status: 'unconfirmed', deviceReply: 'ok' });
    const lateCompletion = transitionCommand(state, { type: 'completionConfirmed', timestampUtc: time(4) });
    expect(lateCompletion).toMatchObject({ changed: false, error: 'INVALID_TRANSITION' });
  });

  it('keeps rejection, timeout and cancellation distinct', () => {
    const created = createCommandLifecycle('cmd-3', time(0));
    expect(transitionCommand(created, { type: 'rejected', timestampUtc: time(1) }).state.status).toBe('rejected');
    expect(transitionCommand(created, { type: 'timedOut', timestampUtc: time(1) }).state.status).toBe('timedOut');
    expect(transitionCommand(created, { type: 'cancelled', timestampUtc: time(1) }).state.status).toBe('cancelled');
  });
});

describe('robot session lifecycle', () => {
  it('never lets showcase data create a connected or enabled session', () => {
    const offline = createOfflineSession('session-1', 'dummy-6dof', time(0));
    const showcase = transitionSession(offline, { type: 'showcaseLoaded', timestampUtc: time(1) }).state;
    expect(showcase).toMatchObject({ connectionState: 'offline', motorState: 'unknown', source: 'showcase' });
    const status = transitionSession(showcase, {
      type: 'statusObserved', timestampUtc: time(2), motorState: 'enabled', controlMode: 1
    });
    expect(status).toMatchObject({ changed: false, error: 'INVALID_TRANSITION' });
    expect(status.state.connectionState).toBe('offline');
  });

  it('requires transport evidence and accepts only modes 1..3', () => {
    let state = createOfflineSession('session-2', 'dummy-6dof', time(0));
    state = transitionSession(state, { type: 'connectRequested', timestampUtc: time(1) }).state;
    state = transitionSession(state, { type: 'transportOpened', timestampUtc: time(2) }).state;
    expect(state).toMatchObject({ connectionState: 'connected', motorState: 'unknown', validity: 'stale' });
    const unsupported = transitionSession(state, {
      type: 'statusObserved', timestampUtc: time(3), motorState: 'enabled', controlMode: 5
    });
    expect(unsupported).toMatchObject({ changed: true, error: 'UNSUPPORTED_CONTROL_MODE' });
    expect(unsupported.state).toMatchObject({ connectionState: 'connected', motorState: 'unknown', controlMode: null, validity: 'invalid' });
  });

  it('clears motion authority on disconnect', () => {
    let state = createOfflineSession('session-3', 'dummy-6dof', time(0));
    state = transitionSession(state, { type: 'connectRequested', timestampUtc: time(1) }).state;
    state = transitionSession(state, { type: 'transportOpened', timestampUtc: time(2) }).state;
    state = transitionSession(state, {
      type: 'statusObserved', timestampUtc: time(3), motorState: 'enabled', controlMode: 2
    }).state;
    state = transitionSession(state, { type: 'transportLost', timestampUtc: time(4), willRetry: true }).state;
    expect(state).toMatchObject({ connectionState: 'reconnecting', motorState: 'unknown', controlMode: null, validity: 'unavailable' });
  });
});
