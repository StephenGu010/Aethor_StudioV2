import type { SignalSeries } from '@aethor/contracts';
import { describe, expect, it } from 'vitest';
import { buildSignalCsv } from './signalCsv';

describe('signal CSV export', () => {
  it('exports long-form samples in timestamp and signal order with full provenance', () => {
    const series: SignalSeries[] = [
      {
        descriptor: { signalId: 'j2.actual', displayName: 'J2, Actual', unit: 'deg', source: 'measured', color: '#fff' },
        samples: [{ timestampUtc: '2026-08-09T00:00:01.000Z', value: null, validity: 'stale' }]
      },
      {
        descriptor: { signalId: 'j1.actual', displayName: 'J1 Actual', unit: 'deg', source: 'measured', color: '#fff' },
        samples: [{ timestampUtc: '2026-08-09T00:00:00.000Z', value: 12.5, validity: 'valid' }]
      }
    ];

    expect(buildSignalCsv(series, { sessionId: 'device-session', profileId: 'dummy-6dof' })).toBe([
      'timestamp_utc,session_id,profile_id,signal_id,display_name,source,unit,value,validity',
      '2026-08-09T00:00:00.000Z,"device-session","dummy-6dof","j1.actual","J1 Actual",MEASURED,deg,12.5,VALID',
      '2026-08-09T00:00:01.000Z,"device-session","dummy-6dof","j2.actual","J2, Actual",MEASURED,deg,,STALE'
    ].join('\n'));
  });
});
