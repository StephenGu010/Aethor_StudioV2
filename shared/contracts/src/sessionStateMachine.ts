import type { DummyControlMode, MotorState, RobotSessionSnapshot } from './types';

export type SessionEvent =
  | { type: 'showcaseLoaded'; timestampUtc: string }
  | { type: 'connectRequested'; timestampUtc: string }
  | { type: 'transportOpened'; timestampUtc: string }
  | { type: 'statusObserved'; timestampUtc: string; motorState: MotorState; controlMode: number }
  | { type: 'feedbackStale'; timestampUtc: string }
  | { type: 'transportLost'; timestampUtc: string; willRetry: boolean }
  | { type: 'disconnectRequested'; timestampUtc: string }
  | { type: 'transportClosed'; timestampUtc: string }
  | { type: 'transportFault'; timestampUtc: string };

export interface SessionTransition {
  state: RobotSessionSnapshot;
  changed: boolean;
  error: 'INVALID_TRANSITION' | 'UNSUPPORTED_CONTROL_MODE' | null;
}

export function createOfflineSession(
  sessionId: string,
  profileId: string,
  timestampUtc: string
): RobotSessionSnapshot {
  if (!sessionId.trim() || !profileId.trim()) throw new Error('sessionId and profileId are required');
  return {
    sessionId,
    profileId,
    connectionState: 'offline',
    motorState: 'unknown',
    controlMode: null,
    timestampUtc,
    source: 'unavailable',
    validity: 'unavailable'
  };
}

export function transitionSession(current: RobotSessionSnapshot, event: SessionEvent): SessionTransition {
  if (event.type === 'showcaseLoaded') {
    if (current.connectionState !== 'offline') return invalid(current);
    return update(current, {
      connectionState: 'offline', motorState: 'unknown', controlMode: null,
      timestampUtc: event.timestampUtc, source: 'showcase', validity: 'valid'
    });
  }

  if (event.type === 'connectRequested') {
    if (current.connectionState !== 'offline' && current.connectionState !== 'faulted') return invalid(current);
    return update(current, {
      connectionState: 'connecting', motorState: 'unknown', controlMode: null,
      timestampUtc: event.timestampUtc, source: 'unavailable', validity: 'unavailable'
    });
  }

  if (event.type === 'transportOpened') {
    if (current.connectionState !== 'connecting' && current.connectionState !== 'reconnecting') return invalid(current);
    return update(current, {
      connectionState: 'connected', motorState: 'unknown', controlMode: null,
      timestampUtc: event.timestampUtc, source: 'measured', validity: 'stale'
    });
  }

  if (event.type === 'statusObserved') {
    if (current.connectionState !== 'connected') return invalid(current);
    if (!isDummyControlMode(event.controlMode)) {
      return {
        state: {
          ...current, motorState: 'unknown', controlMode: null,
          timestampUtc: event.timestampUtc, source: 'measured', validity: 'invalid'
        },
        changed: true,
        error: 'UNSUPPORTED_CONTROL_MODE'
      };
    }
    return update(current, {
      motorState: event.motorState,
      controlMode: event.controlMode,
      timestampUtc: event.timestampUtc,
      source: 'measured',
      validity: 'valid'
    });
  }

  if (event.type === 'feedbackStale') {
    if (current.connectionState !== 'connected') return invalid(current);
    return update(current, { timestampUtc: event.timestampUtc, validity: 'stale' });
  }

  if (event.type === 'transportLost') {
    if (!['connecting', 'connected', 'reconnecting', 'disconnecting'].includes(current.connectionState)) return invalid(current);
    return update(current, {
      connectionState: event.willRetry ? 'reconnecting' : 'offline',
      motorState: 'unknown', controlMode: null, timestampUtc: event.timestampUtc,
      source: 'unavailable', validity: 'unavailable'
    });
  }

  if (event.type === 'disconnectRequested') {
    if (!['connecting', 'connected', 'reconnecting', 'faulted'].includes(current.connectionState)) return invalid(current);
    return update(current, {
      connectionState: 'disconnecting', motorState: 'unknown', controlMode: null,
      timestampUtc: event.timestampUtc, source: 'unavailable', validity: 'unavailable'
    });
  }

  if (event.type === 'transportClosed') {
    if (current.connectionState === 'offline') return invalid(current);
    return update(current, {
      connectionState: 'offline', motorState: 'unknown', controlMode: null,
      timestampUtc: event.timestampUtc, source: 'unavailable', validity: 'unavailable'
    });
  }

  if (event.type === 'transportFault') {
    return update(current, {
      connectionState: 'faulted', motorState: 'unknown', controlMode: null,
      timestampUtc: event.timestampUtc, source: 'unavailable', validity: 'invalid'
    });
  }

  return invalid(current);
}

export function isDummyControlMode(value: number): value is DummyControlMode {
  return value === 1 || value === 2 || value === 3;
}

function update(
  current: RobotSessionSnapshot,
  patch: Partial<RobotSessionSnapshot>
): SessionTransition {
  return { state: { ...current, ...patch }, changed: true, error: null };
}

function invalid(state: RobotSessionSnapshot): SessionTransition {
  return { state, changed: false, error: 'INVALID_TRANSITION' };
}
