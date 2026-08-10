import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { SignalSeries } from '@aethor/contracts';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  CanvasRenderer
]);

export function SignalChart({ series }: { series: SignalSeries[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = echarts.init(host, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      chartRef.current = null;
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(buildSignalChartOption(series), {
      notMerge: false,
      lazyUpdate: true,
      replaceMerge: ['series', 'yAxis']
    });
  }, [series]);

  return <div className="signalChart" ref={hostRef} role="img" aria-label="关节信号时序图" />;
}

export function buildSignalChartOption(series: SignalSeries[]) {
  const units = [...new Set(series.map((item) => item.descriptor.unit))];
  const unitAxisIndex = new Map(units.map((unit, index) => [unit, index]));
  return {
      animation: false,
      backgroundColor: 'transparent',
      color: series.map((item) => item.descriptor.color),
      grid: { top: 58, right: units.length > 1 ? 72 : 30, bottom: 70, left: 68 },
      legend: {
        top: 10,
        left: 8,
        right: 8,
        textStyle: { color: '#a6acb3', fontSize: 11 },
        itemWidth: 20,
        itemHeight: 2,
        inactiveColor: '#41464c'
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#dfe4e8', width: 1 } },
        backgroundColor: 'rgba(15, 17, 19, .96)',
        borderColor: '#343a40',
        textStyle: { color: '#e7e9eb', fontFamily: 'Cascadia Mono, monospace', fontSize: 11 }
      },
      toolbox: {
        right: 10,
        top: 8,
        iconStyle: { borderColor: '#737b83' },
        emphasis: { iconStyle: { borderColor: '#e8ecef' } },
        feature: { dataZoom: { yAxisIndex: 'none' }, restore: {} }
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#30353a' } },
        axisTick: { show: false },
        axisLabel: { color: '#747c84', fontSize: 10 },
        splitLine: { show: true, lineStyle: { color: '#202429' } }
      },
      yAxis: units.map((unit, index) => ({
        type: 'value',
        name: `${unitLabel(unit)} / ${unit}`,
        nameTextStyle: { color: '#737b83', fontSize: 10, align: 'left' },
        scale: true,
        position: index === 0 ? 'left' : 'right',
        offset: index <= 1 ? 0 : (index - 1) * 54,
        axisLine: { show: true, lineStyle: { color: '#30353a' } },
        axisLabel: { color: '#747c84', fontSize: 10 },
        splitLine: { show: index === 0, lineStyle: { color: '#202429' } }
      })),
      dataZoom: [
        { type: 'inside', filterMode: 'none' },
        {
          type: 'slider',
          bottom: 14,
          height: 20,
          borderColor: '#2c3136',
          backgroundColor: '#15181b',
          fillerColor: 'rgba(169, 199, 216, .13)',
          dataBackground: { lineStyle: { color: '#606972' }, areaStyle: { color: '#252a2f' } },
          selectedDataBackground: { lineStyle: { color: '#a9c7d8' }, areaStyle: { color: '#3e4851' } },
          textStyle: { color: '#737b83' },
          handleStyle: { color: '#d9dde0', borderColor: '#d9dde0' }
        }
      ],
      series: series.map((item) => ({
        id: item.descriptor.signalId,
        name: item.descriptor.displayName,
        type: 'line',
        yAxisIndex: unitAxisIndex.get(item.descriptor.unit) ?? 0,
        showSymbol: false,
        sampling: 'lttb',
        connectNulls: false,
        lineStyle: {
          width: item.descriptor.source === 'computed' ? 1 : 1.5,
          type: item.descriptor.dashed ? 'dashed' : 'solid',
          opacity: item.descriptor.source === 'computed' ? 0.8 : 1
        },
        data: item.samples.map((sample) => [sample.timestampUtc, sample.value])
      }))
    };
}

function unitLabel(unit: SignalSeries['descriptor']['unit']) {
  switch (unit) {
    case 'deg': return 'ANGLE';
    case 'deg/s': return 'VELOCITY';
    case 'ms': return 'LATENCY';
    case 'Hz': return 'RATE';
  }
}
