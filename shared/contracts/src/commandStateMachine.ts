import type { CommandResult, CommandStatus } from './types';

export type CommandLifecycleStatus = 'created' | CommandStatus;
export type CommandEvidence = 'none' | 'gatewayAccepted' | 'deviceQueued' | 'deviceAck' | 'feedbackConfirmed';

export interface CommandLifecycleState {
  commandId: string;
  status: CommandLifecycleStatus;
  evidence: CommandEvidence;
  updatedAtUtc: string;
}

export type CommandLifecycleEvent =
  | { type: 'gatewayAccepted'; timestampUtc: string }
  | { type: 'unsupported'; timestampUtc: string }
  | { type: 'rejected'; timestampUtc: string }
  | { type: 'deviceQueued'; timestampUtc: string }
  | { type: 'deviceAck'; timestampUtc: string }
  | { type: 'completionConfirmed'; timestampUtc: string }
  | { type: 'failed'; timestampUtc: string }
  | { type: 'timedOut'; timestampUtc: string }
  | { type: 'cancelled'; timestampUtc: string }
  | { type: 'confirmationUnavailable'; timestampUtc: string };

export interface CommandTransition {
  state: CommandLifecycleState;
  changed: boolean;
  error: 'INVALID_TRANSITION' | null;
}

const terminalStatuses = new Set<CommandLifecycleStatus>([
  'unsupported', 'rejected', 'completed', 'failed', 'timedOut', 'cancelled', 'unconfirmed'
]);

export function createCommandLifecycle(commandId: string, timestampUtc: string): CommandLifecycleState {
  if (!commandId.trim()) throw new Error('commandId must not be empty');
  return { commandId, status: 'created', evidence: 'none', updatedAtUtc: timestampUtc };
}

export function transitionCommand(
  current: CommandLifecycleState,
  event: CommandLifecycleEvent
): CommandTransition {
  if (terminalStatuses.has(current.status)) return unchanged(current);

  if (current.status === 'created') {
    if (event.type === 'gatewayAccepted') return changed(current, 'accepted', 'gatewayAccepted', event.timestampUtc);
    if (event.type === 'unsupported' || event.type === 'rejected' || event.type === 'cancelled') {
      return changed(current, event.type, 'none', event.timestampUtc);
    }
    if (event.type === 'failed' || event.type === 'timedOut') {
      return changed(current, event.type, 'none', event.timestampUtc);
    }
    return unchanged(current);
  }

  if (event.type === 'deviceQueued') return changed(current, 'accepted', 'deviceQueued', event.timestampUtc);
  if (event.type === 'deviceAck') return changed(current, 'accepted', 'deviceAck', event.timestampUtc);
  if (event.type === 'completionConfirmed') return changed(current, 'completed', 'feedbackConfirmed', event.timestampUtc);
  if (event.type === 'failed' || event.type === 'timedOut' || event.type === 'cancelled') {
    return changed(current, event.type, current.evidence, event.timestampUtc);
  }
  if (event.type === 'confirmationUnavailable') {
    return changed(current, 'unconfirmed', current.evidence, event.timestampUtc);
  }
  return unchanged(current);
}

export function toCommandResult(
  state: CommandLifecycleState,
  message: string,
  deviceReply?: string
): CommandResult {
  if (state.status === 'created') throw new Error('created command has no public result');
  return {
    commandId: state.commandId,
    status: state.status,
    message,
    timestampUtc: state.updatedAtUtc,
    ...(deviceReply === undefined ? {} : { deviceReply })
  };
}

function changed(
  current: CommandLifecycleState,
  status: Exclude<CommandLifecycleStatus, 'created'>,
  evidence: CommandEvidence,
  updatedAtUtc: string
): CommandTransition {
  return { state: { ...current, status, evidence, updatedAtUtc }, changed: true, error: null };
}

function unchanged(state: CommandLifecycleState): CommandTransition {
  return { state, changed: false, error: 'INVALID_TRANSITION' };
}
