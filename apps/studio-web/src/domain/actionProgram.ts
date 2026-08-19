import { DEFAULT_ACTION_PROGRAM_SPEED_DEG_S } from '@aethor/contracts';
import type {
  ActionPostArrivalWaitV1,
  ActionProgramSourceV1,
  ActionProgramV1,
  ActionWaypointSourceV1,
  ActionWaypointV1,
  DummyControlMode,
  RobotProfileManifestV1
} from '@aethor/contracts';
import { z } from 'zod';

export const MAX_ACTION_PROGRAM_BYTES = 1024 * 1024;
export const MAX_ACTION_WAYPOINTS = 256;

export interface ActionProgramValidation {
  valid: boolean;
  program: ActionProgramV1 | null;
  errors: string[];
}

const utcTimestamp = z.string().refine(
  (value) => /(?:Z|\+00:00)$/i.test(value) && Number.isFinite(Date.parse(value)),
  '必须是 UTC ISO 8601 时间'
);
const postArrivalWaitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('durationAfterConfirmed'),
    durationMs: z.number().int().min(1).max(600_000)
  }).strict()
]);
const waypointSchema = z.object({
  waypointId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  positionsDeg: z.array(z.number().finite()).length(6),
  mode: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  postArrivalWait: postArrivalWaitSchema,
  notes: z.string().max(500),
  source: z.enum(['manual', 'measuredCapture', 'showcaseExample']),
  capturedAtUtc: utcTimestamp.nullable()
}).strict().superRefine((waypoint, context) => {
  if (waypoint.source === 'measuredCapture' && waypoint.capturedAtUtc === null) {
    context.addIssue({ code: 'custom', path: ['capturedAtUtc'], message: '实测采集点必须记录采集时间' });
  }
  if (waypoint.source !== 'measuredCapture' && waypoint.capturedAtUtc !== null) {
    context.addIssue({ code: 'custom', path: ['capturedAtUtc'], message: '非实测点不得伪造采集时间' });
  }
});
const actionProgramSchema = z.object({
  schemaVersion: z.literal('1.0'),
  programId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  revision: z.number().int().min(1).max(2_147_483_647),
  profileId: z.literal('dummy-6dof'),
  jointCoordinateSystem: z.literal('dummy-device-joints-v1'),
  createdAtUtc: utcTimestamp,
  updatedAtUtc: utcTimestamp,
  source: z.enum(['authored', 'showcaseExample']),
  speedDegS: z.number().finite().gt(0).max(100).default(DEFAULT_ACTION_PROGRAM_SPEED_DEG_S),
  loopEnabled: z.boolean().default(false),
  notes: z.string().max(2_000),
  waypoints: z.array(waypointSchema).max(MAX_ACTION_WAYPOINTS)
}).strict();

export function validateActionProgramV1(
  input: unknown,
  profile: RobotProfileManifestV1
): ActionProgramValidation {
  if (!isRecord(input) || input.schemaVersion !== '1.0') {
    return {
      valid: false,
      program: null,
      errors: ['不支持的动作程序版本；当前仅接受 schemaVersion 1.0，且不会静默迁移']
    };
  }
  const parsed = actionProgramSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      program: null,
      errors: parsed.error.issues.map((issue) => `${formatPath(issue.path)}：${issue.message}`)
    };
  }

  const program = parsed.data;
  const errors: string[] = [];
  if (program.profileId !== profile.profileId || profile.model.dof !== 6) {
    errors.push(`动作程序要求 dummy-6dof 六轴 Profile；当前为 ${profile.profileId} / ${profile.model.dof}-DOF`);
  }
  if (Date.parse(program.updatedAtUtc) < Date.parse(program.createdAtUtc)) {
    errors.push('updatedAtUtc 不能早于 createdAtUtc');
  }
  const waypointIds = new Set<string>();
  program.waypoints.forEach((waypoint, waypointIndex) => {
    if (waypointIds.has(waypoint.waypointId)) {
      errors.push(`点位 ${waypointIndex + 1} 的 waypointId 重复`);
    }
    waypointIds.add(waypoint.waypointId);
  });

  return {
    valid: errors.length === 0,
    program: errors.length === 0 ? cloneActionProgram(program) : null,
    errors
  };
}

export function parseActionProgramJson(
  text: string,
  profile: RobotProfileManifestV1
): ActionProgramValidation {
  if (new TextEncoder().encode(text).byteLength > MAX_ACTION_PROGRAM_BYTES) {
    return { valid: false, program: null, errors: ['动作程序超过 1 MiB 文件上限'] };
  }
  try {
    return validateActionProgramV1(JSON.parse(text), profile);
  } catch {
    return { valid: false, program: null, errors: ['文件不是有效的 JSON'] };
  }
}

export function serializeActionProgramV1(program: ActionProgramV1, profile: RobotProfileManifestV1) {
  const validation = validateActionProgramV1(program, profile);
  if (!validation.valid || !validation.program) {
    throw new Error(validation.errors.join('；'));
  }
  return `${JSON.stringify(validation.program, null, 2)}\n`;
}

export function createActionProgramV1({
  programId,
  name,
  timestampUtc,
  source = 'authored',
  speedDegS = DEFAULT_ACTION_PROGRAM_SPEED_DEG_S,
  loopEnabled = false,
  waypoints = []
}: {
  programId: string;
  name: string;
  timestampUtc: string;
  source?: ActionProgramSourceV1;
  speedDegS?: number;
  loopEnabled?: boolean;
  waypoints?: ActionWaypointV1[];
}): ActionProgramV1 {
  return {
    schemaVersion: '1.0',
    programId,
    name,
    revision: 1,
    profileId: 'dummy-6dof',
    jointCoordinateSystem: 'dummy-device-joints-v1',
    createdAtUtc: timestampUtc,
    updatedAtUtc: timestampUtc,
    source,
    speedDegS,
    loopEnabled,
    notes: '',
    waypoints: waypoints.map(cloneWaypoint)
  };
}

export function createActionWaypointV1({
  waypointId,
  sequence,
  positionsDeg,
  source,
  timestampUtc,
  mode = 2
}: {
  waypointId: string;
  sequence: number;
  positionsDeg: number[];
  source: ActionWaypointSourceV1;
  timestampUtc: string;
  mode?: DummyControlMode;
}): ActionWaypointV1 {
  return {
    waypointId,
    name: `点位 ${String(sequence).padStart(2, '0')}`,
    positionsDeg: [...positionsDeg],
    mode,
    postArrivalWait: { kind: 'none' },
    notes: '',
    source,
    capturedAtUtc: source === 'measuredCapture' ? timestampUtc : null
  };
}

export function cloneActionProgram(program: ActionProgramV1): ActionProgramV1 {
  return { ...program, waypoints: program.waypoints.map(cloneWaypoint) };
}

export function actionProgramFileName(program: ActionProgramV1) {
  const safeName = program.name.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'action-program';
  return `${safeName}.aethor-action.json`;
}

export function updatePostArrivalWait(durationMs: number): ActionPostArrivalWaitV1 {
  return durationMs > 0
    ? { kind: 'durationAfterConfirmed', durationMs: Math.min(600_000, Math.round(durationMs)) }
    : { kind: 'none' };
}

function cloneWaypoint(waypoint: ActionWaypointV1): ActionWaypointV1 {
  return {
    ...waypoint,
    positionsDeg: [...waypoint.positionsDeg],
    postArrivalWait: { ...waypoint.postArrivalWait }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(path: PropertyKey[]) {
  return path.length === 0 ? 'document' : path.map(String).join('.');
}
