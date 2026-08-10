import { describe, expect, it } from 'vitest';
import { buildProtocolLogText } from './protocolExport';

describe('protocol log export', () => {
  it('includes provenance and sanitizes embedded control characters', () => {
    expect(buildProtocolLogText([{
      id: 'frame-1', timestampUtc: '2026-08-09T00:00:00.000Z', direction: 'error',
      raw: 'bad\tframe', parsedKind: 'PARSE\nERROR', source: 'measured', correlationId: 'query-1'
    }])).toBe([
      'timestamp_utc\tdirection\traw\tparsed_kind\tsource\tcorrelation_id',
      '2026-08-09T00:00:00.000Z\tERROR\tbad frame\tPARSE ERROR\tMEASURED\tquery-1'
    ].join('\n'));
  });
});
