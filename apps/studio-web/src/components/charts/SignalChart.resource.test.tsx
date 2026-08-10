import type { SignalSeries } from '@aethor/contracts';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn()
}));
const init = vi.hoisted(() => vi.fn(() => chart));

vi.mock('echarts/core', () => ({ use: vi.fn(), init }));
vi.mock('echarts/charts', () => ({ LineChart: {} }));
vi.mock('echarts/components', () => ({
  DataZoomComponent: {}, GridComponent: {}, LegendComponent: {}, ToolboxComponent: {}, TooltipComponent: {}
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import { SignalChart } from './SignalChart';

describe('SignalChart resource ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reuses one ECharts instance across data refreshes and disposes it once', () => {
    const { rerender, unmount } = render(<SignalChart series={[signal(1)]} />);
    rerender(<SignalChart series={[signal(2)]} />);

    expect(init).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenCalledTimes(2);
    expect(chart.dispose).not.toHaveBeenCalled();
    unmount();
    expect(chart.dispose).toHaveBeenCalledTimes(1);
  });
});

function signal(value: number): SignalSeries {
  return {
    descriptor: { signalId: 'j1.actual', displayName: 'J1 Actual', unit: 'deg', source: 'measured', color: '#fff' },
    samples: [{ timestampUtc: '2026-08-09T00:00:00.000Z', value, validity: 'valid' }]
  };
}
