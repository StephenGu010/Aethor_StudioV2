export interface OperationProbe {
  eventId: string;
  operationId: string;
  outcome: 'started' | 'completed' | 'failed';
  durationMs?: number;
  resultCount?: number;
  failureCategory?: string;
}

const PROBE_PREFIX = 'AETHOR_PROBE_V1 ';

export function emitOperationProbe(probe: OperationProbe) {
  const bounded = {
    eventId: probe.eventId.slice(0, 96),
    operationId: probe.operationId.slice(0, 64),
    outcome: probe.outcome,
    ...(probe.durationMs === undefined ? {} : { durationMs: Math.round(probe.durationMs * 10) / 10 }),
    ...(probe.resultCount === undefined ? {} : { resultCount: probe.resultCount }),
    ...(probe.failureCategory === undefined ? {} : { failureCategory: probe.failureCategory.slice(0, 48) })
  };
  console.info(`${PROBE_PREFIX}${JSON.stringify(bounded)}`);
}

export function classifyOperationFailure(cause: unknown) {
  if (!(cause instanceof Error)) return 'unknown';
  if (cause.name === 'AbortError') return 'cancelled';
  const status = 'status' in cause && typeof cause.status === 'number' ? cause.status : null;
  if (status === 401) return 'authentication';
  if (status === 408 || /timeout|超时/i.test(cause.message)) return 'timeout';
  if (status === 400 || /contract|契约|响应不符合/i.test(cause.message)) return 'validation';
  if (status === 409) return 'conflict';
  if (status === 503) return 'dependency';
  if (status === 0) return 'transport';
  return 'unknown';
}
