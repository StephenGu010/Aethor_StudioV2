import type {
  JointStateFrame,
  OperationEvent,
  ProtocolFrame,
  RobotSessionSnapshot,
  SignalSeries
} from '@aethor/contracts';

const captureStartMs = Date.parse('2026-08-07T06:31:40.000Z');
const baseActual = [12.4, -36.1, 18.55, 44.85, -22.35, 89.9];
const baseTarget = [12.4, -36.2, 18.6, 45, -22.3, 90];
const colors = ['#a9c7d8', '#d7ddd8', '#73a98f', '#d6b35a', '#a7a0c8', '#c99a79'];

export const showcaseSession: RobotSessionSnapshot = {
  sessionId: 'showcase-offline',
  profileId: 'dummy-6dof',
  connectionState: 'offline',
  motorState: 'unknown',
  controlMode: null,
  timestampUtc: new Date(captureStartMs + 30_000).toISOString(),
  source: 'showcase',
  validity: 'unavailable'
};

export const showcaseJointFrame: JointStateFrame = {
  sequence: 600,
  profileId: 'dummy-6dof',
  timestampUtc: new Date(captureStartMs + 30_000).toISOString(),
  positionsDeg: [...baseActual],
  source: 'showcase',
  validity: 'valid'
};

export const showcaseProtocolFrames: ProtocolFrame[] = [
  frame(0, 'tx', '#GETJPOS', 'QUERY'),
  frame(32, 'rx', 'ok 12.400 -36.100 18.550 44.850 -22.350 89.900', 'JOINT_STATE'),
  frame(90, 'tx', '#GETMODE', 'QUERY'),
  frame(118, 'rx', 'ok 2 INT_POINT', 'MODE_STATE'),
  frame(176, 'tx', '#GETENABLE', 'QUERY'),
  frame(202, 'rx', 'ok 1', 'ENABLE_STATE'),
  frame(740, 'tx', '>12.400,-36.200,18.600,45.000,-22.300,90.000,18.000', 'MOTION_STREAM'),
  frame(749, 'rx', '14', 'FIFO_REMAINING'),
  frame(1180, 'rx', 'ok', 'MOTION_COMPLETE'),
  {
    id: 'pf-error',
    timestampUtc: new Date(captureStartMs + 1_860).toISOString(),
    direction: 'error',
    raw: 'error CMD FIFO FULL',
    parsedKind: 'DEVICE_ERROR',
    source: 'showcase'
  }
];

export const showcaseEvents: OperationEvent[] = [
  event(2_000, 'info', 'RX joint state updated', '六轴展示采集帧已载入'),
  event(5_000, 'info', 'Target preview aligned', '目标草稿与展示反馈对齐'),
  event(8_000, 'warning', 'J4 following error warning', '样例误差超过展示阈值；非实时报警'),
  event(13_000, 'info', 'Model profile validated', 'Dummy / dummy-6dof / schema 1.0')
];

export const showcaseSignalSeries: SignalSeries[] = Array.from({ length: 6 }, (_, jointIndex) => {
  const actual = buildSeries(jointIndex, 'actual');
  const target = buildSeries(jointIndex, 'target');
  return [
    {
      descriptor: {
        signalId: `j${jointIndex + 1}.actual.position`,
        displayName: `J${jointIndex + 1} Actual`,
        unit: 'deg' as const,
        source: 'showcase' as const,
        color: colors[jointIndex] ?? '#d7ddd8',
        jointId: `j${jointIndex + 1}`
      },
      samples: actual
    },
    {
      descriptor: {
        signalId: `j${jointIndex + 1}.target.position`,
        displayName: `J${jointIndex + 1} Target`,
        unit: 'deg' as const,
        source: 'commanded' as const,
        color: colors[jointIndex] ?? '#d7ddd8',
        dashed: true,
        jointId: `j${jointIndex + 1}`
      },
      samples: target
    },
    {
      descriptor: {
        signalId: `j${jointIndex + 1}.computed.error`,
        displayName: `J${jointIndex + 1} Error`,
        unit: 'deg' as const,
        source: 'computed' as const,
        color: '#d6b35a',
        jointId: `j${jointIndex + 1}`
      },
      samples: actual.map((sample, index) => {
        const targetValue = target[index]?.value;
        return {
          timestampUtc: sample.timestampUtc,
          value: sample.value === null || targetValue === null || targetValue === undefined ? null : targetValue - sample.value,
          validity: sample.validity
        };
      })
    }
  ];
}).flat();

function buildSeries(jointIndex: number, kind: 'actual' | 'target') {
  return Array.from({ length: 600 }, (_, sampleIndex) => {
    const t = sampleIndex / 20;
    const phase = jointIndex * 0.72;
    const base = kind === 'actual' ? baseActual[jointIndex] ?? 0 : baseTarget[jointIndex] ?? 0;
    const oscillation = Math.sin(t * (0.34 + jointIndex * 0.017) + phase) * (1.2 + jointIndex * 0.16);
    const lag = kind === 'actual' ? Math.sin(t * 0.8 + phase) * 0.08 : 0;
    return {
      timestampUtc: new Date(captureStartMs + sampleIndex * 50).toISOString(),
      value: Number((base + oscillation - lag).toFixed(4)),
      validity: 'valid' as const
    };
  });
}

function frame(offsetMs: number, direction: ProtocolFrame['direction'], raw: string, parsedKind: string): ProtocolFrame {
  return {
    id: `pf-${offsetMs}-${direction}`,
    timestampUtc: new Date(captureStartMs + offsetMs).toISOString(),
    direction,
    raw,
    parsedKind,
    source: 'showcase'
  };
}

function event(
  offsetMs: number,
  severity: OperationEvent['severity'],
  title: string,
  detail: string
): OperationEvent {
  return {
    id: `event-${offsetMs}`,
    timestampUtc: new Date(captureStartMs + offsetMs).toISOString(),
    severity,
    title,
    detail,
    source: 'showcase'
  };
}
