import type { CommandAuditRecord, CommandResult, RobotCommandKind } from '@aethor/contracts';

const uncertainStatuses = new Set<CommandResult['status']>(['unconfirmed', 'failed', 'timedOut']);

export interface CommandSafetyState {
  latchedResult: CommandResult | null;
  confirmedStopTimestampUtc: string | null;
}

export function isSafetyLatchedResult(result: CommandResult) {
  return uncertainStatuses.has(result.status) || result.code === 'safetyInterlockLatched';
}

export function reconcileLatchedSafetyResult(
  history: CommandAuditRecord[],
  sessionId: string,
  current: CommandResult | null
): CommandResult | null {
  return reconcileCommandSafetyState(history, sessionId, {
    latchedResult: current?.sessionId === sessionId ? current : null,
    confirmedStopTimestampUtc: null
  }).latchedResult;
}

export function reduceLatchedSafetyResult(
  current: CommandResult | null,
  result: CommandResult
): CommandResult | null {
  return reduceCommandSafetyState({
    latchedResult: current,
    confirmedStopTimestampUtc: null
  }, result).latchedResult;
}

export function reconcileCommandSafetyState(
  history: CommandAuditRecord[],
  sessionId: string,
  current: CommandSafetyState
): CommandSafetyState {
  let next = current.latchedResult !== null && current.latchedResult.sessionId !== sessionId
    ? { latchedResult: null, confirmedStopTimestampUtc: null }
    : current;
  for (const record of history) {
    if (record.result.sessionId === sessionId) next = reduceCommandSafetyState(next, record.result);
  }
  return next;
}

export function reduceCommandSafetyState(
  current: CommandSafetyState,
  result: CommandResult
): CommandSafetyState {
  const resultTimestamp = parseTimestamp(result.timestampUtc);
  const confirmedStopTimestamp = parseTimestamp(current.confirmedStopTimestampUtc);

  if (result.commandKind === 'stopAndDisable' && result.status === 'completed') {
    if (resultTimestamp === null || (confirmedStopTimestamp !== null && resultTimestamp < confirmedStopTimestamp)) {
      return current;
    }
    const latchedTimestamp = parseTimestamp(current.latchedResult?.timestampUtc ?? null);
    return {
      latchedResult: latchedTimestamp !== null && latchedTimestamp > resultTimestamp
        ? current.latchedResult
        : null,
      confirmedStopTimestampUtc: result.timestampUtc
    };
  }

  if (!isSafetyLatchedResult(result)) return current;
  if (resultTimestamp !== null && confirmedStopTimestamp !== null && resultTimestamp <= confirmedStopTimestamp) {
    return current;
  }

  const latchedTimestamp = parseTimestamp(current.latchedResult?.timestampUtc ?? null);
  if (current.latchedResult && (resultTimestamp === null || (latchedTimestamp !== null && resultTimestamp < latchedTimestamp))) {
    return current;
  }
  return { ...current, latchedResult: result };
}

export function createUnconfirmedTransportResult({
  commandId,
  sessionId,
  commandKind,
  message
}: {
  commandId: string;
  sessionId: string;
  commandKind: RobotCommandKind;
  message: string;
}): CommandResult {
  return {
    commandId,
    sessionId,
    commandKind,
    status: 'unconfirmed',
    code: 'transportError',
    evidence: 'none',
    message,
    timestampUtc: new Date().toISOString()
  };
}

function parseTimestamp(value: string | null) {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
