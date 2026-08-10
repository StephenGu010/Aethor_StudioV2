import type { SignalSeries } from '@aethor/contracts';
import { describe, expect, it } from 'vitest';
import { buildSignalChartOption } from './SignalChart';

describe('signal chart option', () => {
  it('assigns each engineering unit to its own y axis', () => {
    const series: SignalSeries[] = [
      signal('position', 'deg'),
      signal('velocity', 'deg/s'),
      signal('latency', 'ms')
    ];

    const option = buildSignalChartOption(series);
    expect(option.yAxis.map((axis) => axis.name)).toEqual(['ANGLE / deg', 'VELOCITY / deg/s', 'LATENCY / ms']);
    expect(option.series.map((item) => item.yAxisIndex)).toEqual([0, 1, 2]);
  });
});

function signal(signalId: string, unit: SignalSeries['descriptor']['unit']): SignalSeries {
  return {
    descriptor: { signalId, displayName: signalId, unit, source: 'measured', color: '#fff' },
    samples: [{ timestampUtc: '2026-08-09T00:00:00.000Z', value: 1, validity: 'valid' }]
  };
}
