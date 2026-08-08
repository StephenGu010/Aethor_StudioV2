import type { DummyControlMode } from './types';

export const DUMMY_ASCII_BAUD_RATE = 115_200;
export const DUMMY_ASCII_LINE_ENDING = '\n';
export const DUMMY_ASCII_MAX_LINE_CHARS = 255;
export const DUMMY_ASCII_MOTION_QUEUE_BYTES = 64;

export type DummyJointVector = [number, number, number, number, number, number];
export type DummyCommandRisk = 'low' | 'medium' | 'high';
export type DummyStructuredCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'disable' }
  | { type: 'home' }
  | { type: 'reset' }
  | { type: 'queryJointPositions' }
  | { type: 'queryMode' }
  | { type: 'queryEnable' }
  | { type: 'setMode'; mode: DummyControlMode }
  | { type: 'jointGroup'; positionsDeg: readonly number[]; speedDegS?: number };

export type DummyCommandKind = 'system' | 'query' | 'mode' | 'jointGroup';
export type DummyCommandValidationCode =
  | 'VALID'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'MULTILINE'
  | 'NON_ASCII'
  | 'MODE_NOT_ALLOWED'
  | 'COMMAND_NOT_ALLOWED'
  | 'ARGUMENT_COUNT'
  | 'INVALID_NUMBER'
  | 'MOTION_LINE_TOO_LONG';

export interface DummyRawCommandValidation {
  valid: boolean;
  code: DummyCommandValidationCode;
  kind: DummyCommandKind | 'invalid';
  risk: DummyCommandRisk;
  normalized?: string;
}

export const DUMMY_STRUCTURED_COMMANDS = [
  'start', 'stop', 'disable', 'home', 'reset',
  'queryJointPositions', 'queryMode', 'queryEnable', 'setMode', 'jointGroup'
] as const;

export const DUMMY_COMMAND_POLICIES = {
  start: { completion: 'enableReadback' },
  stop: { completion: 'disabledReadback' },
  disable: { completion: 'disabledReadback' },
  home: { completion: 'neverImplicit' },
  reset: { completion: 'neverImplicit' },
  queryJointPositions: { completion: 'validReply' },
  queryMode: { completion: 'validReply' },
  queryEnable: { completion: 'validReply' },
  setMode: { completion: 'modeReadback' },
  jointGroup: { completion: 'feedbackConvergence' }
} as const;

const exactCommands = new Map<string, { kind: DummyCommandKind; risk: DummyCommandRisk }>([
  ['!START', { kind: 'system', risk: 'high' }],
  ['!STOP', { kind: 'system', risk: 'high' }],
  ['!DISABLE', { kind: 'system', risk: 'high' }],
  ['!HOME', { kind: 'system', risk: 'high' }],
  ['!RESET', { kind: 'system', risk: 'high' }],
  ['#GETJPOS', { kind: 'query', risk: 'low' }],
  ['#GETMODE', { kind: 'query', risk: 'low' }],
  ['#GETENABLE', { kind: 'query', risk: 'low' }]
]);

export function formatDummyCommand(command: DummyStructuredCommand): string {
  switch (command.type) {
    case 'start': return '!START';
    case 'stop': return '!STOP';
    case 'disable': return '!DISABLE';
    case 'home': return '!HOME';
    case 'reset': return '!RESET';
    case 'queryJointPositions': return '#GETJPOS';
    case 'queryMode': return '#GETMODE';
    case 'queryEnable': return '#GETENABLE';
    case 'setMode': {
      assertAllowedMode(command.mode);
      return `#CMDMODE ${command.mode}`;
    }
    case 'jointGroup': {
      if (command.positionsDeg.length !== 6) throw new Error('Dummy joint group requires exactly six positions');
      const values = command.positionsDeg.map((value) => formatFiniteNumber(value, 'joint position'));
      if (command.speedDegS !== undefined) {
        if (command.speedDegS <= 0) throw new Error('speedDegS must be greater than zero');
        values.push(formatFiniteNumber(command.speedDegS, 'joint speed'));
      }
      const line = `>${values.join(',')}`;
      if (line.length >= DUMMY_ASCII_MOTION_QUEUE_BYTES) {
        throw new Error(`Dummy motion command must fit ${DUMMY_ASCII_MOTION_QUEUE_BYTES - 1} ASCII characters`);
      }
      return line;
    }
  }
}

export function encodeDummyCommand(command: DummyStructuredCommand): string {
  return `${formatDummyCommand(command)}${DUMMY_ASCII_LINE_ENDING}`;
}

/** Internal stop-chain compatibility step. Never expose this as a raw or structured user command. */
export function formatDummySafetyZeroCurrent(): '$0,0,0,0,0,0' {
  return '$0,0,0,0,0,0';
}

export function validateDummyRawCommand(raw: string): DummyRawCommandValidation {
  const normalized = raw.trim();
  if (!normalized) return invalid('EMPTY');
  if (/\r|\n/.test(raw)) return invalid('MULTILINE');
  if (normalized.length > DUMMY_ASCII_MAX_LINE_CHARS) return invalid('TOO_LONG');
  if (!/^[\x20-\x7e]+$/.test(normalized)) return invalid('NON_ASCII');

  const exact = exactCommands.get(normalized);
  if (exact) return valid(exact.kind, exact.risk, normalized);

  const modeMatch = /^#CMDMODE\s+(\d+)$/.exec(normalized);
  if (modeMatch) {
    const mode = Number(modeMatch[1]);
    if (mode !== 1 && mode !== 2 && mode !== 3) return invalid('MODE_NOT_ALLOWED');
    return valid('mode', 'high', `#CMDMODE ${mode}`);
  }

  if (normalized.startsWith('>')) return validateJointGroupLine(normalized);
  return invalid('COMMAND_NOT_ALLOWED');
}

export type DummyResponse =
  | { kind: 'systemAck'; raw: string; ack: 'started' | 'stopped' | 'disabled' | 'homing' }
  | { kind: 'genericAck'; raw: string }
  | { kind: 'jointPositions'; raw: string; positionsDeg: DummyJointVector }
  | { kind: 'mode'; raw: string; mode: DummyControlMode; name: 'SEQ_POINT' | 'INT_POINT' | 'CONT_TRAJ' }
  | { kind: 'unsupportedMode'; raw: string; mode: number; name: string }
  | { kind: 'enable'; raw: string; enabled: boolean }
  | { kind: 'modeAck'; raw: string; mode: DummyControlMode; name: 'SEQ_POINT' | 'INT_POINT' | 'CONT_TRAJ' }
  | { kind: 'queue'; raw: string; freeSlots: number; accepted: boolean }
  | { kind: 'error'; raw: string; code: string; detail: string }
  | { kind: 'malformed'; raw: string; reason: 'invalid-number' | 'invalid-mode-name' | 'invalid-queue-value' }
  | { kind: 'unknown'; raw: string };

const modeNames: Record<DummyControlMode, 'SEQ_POINT' | 'INT_POINT' | 'CONT_TRAJ'> = {
  1: 'SEQ_POINT',
  2: 'INT_POINT',
  3: 'CONT_TRAJ'
};

export function parseDummyResponseLine(input: string): DummyResponse {
  const raw = input.trim();
  if (!raw) return { kind: 'unknown', raw };

  const systemAck = new Map<string, 'started' | 'stopped' | 'disabled' | 'homing'>([
    ['Started ok', 'started'], ['Stopped ok', 'stopped'],
    ['Disabled ok', 'disabled'], ['Homing ok', 'homing']
  ]).get(raw);
  if (systemAck) return { kind: 'systemAck', raw, ack: systemAck };
  if (raw === 'ok') return { kind: 'genericAck', raw };

  if (raw.startsWith('error')) {
    const detail = raw.slice('error'.length).trim();
    const code = detail.split(/\s+/)[0] || 'UNKNOWN';
    return { kind: 'error', raw, code, detail };
  }

  if (/^\d+$/.test(raw)) {
    const freeSlots = Number(raw);
    if (freeSlots === 255) return { kind: 'queue', raw, freeSlots, accepted: false };
    if (freeSlots >= 0 && freeSlots <= 15) return { kind: 'queue', raw, freeSlots, accepted: true };
    return { kind: 'malformed', raw, reason: 'invalid-queue-value' };
  }

  const modeAck = /^ok Set command mode to \[(\d+)] \(([A-Z_]+)\)$/.exec(raw);
  if (modeAck) {
    const mode = Number(modeAck[1]);
    const name = modeAck[2] ?? '';
    if (!isAllowedMode(mode)) return { kind: 'unsupportedMode', raw, mode, name };
    if (modeNames[mode] !== name) return { kind: 'malformed', raw, reason: 'invalid-mode-name' };
    return { kind: 'modeAck', raw, mode, name: modeNames[mode] };
  }

  const tokens = raw.split(/\s+/);
  if (tokens[0] === 'ok' && tokens.length === 2 && (tokens[1] === '0' || tokens[1] === '1')) {
    return { kind: 'enable', raw, enabled: tokens[1] === '1' };
  }
  if (tokens[0] === 'ok' && tokens.length === 3 && /^\d+$/.test(tokens[1] ?? '')) {
    const mode = Number(tokens[1]);
    const name = tokens[2] ?? '';
    if (!isAllowedMode(mode)) return { kind: 'unsupportedMode', raw, mode, name };
    if (modeNames[mode] !== name) return { kind: 'malformed', raw, reason: 'invalid-mode-name' };
    return { kind: 'mode', raw, mode, name: modeNames[mode] };
  }
  if (tokens[0] === 'ok' && tokens.length === 7) {
    const positions = tokens.slice(1).map(Number);
    if (positions.some((value) => !Number.isFinite(value))) return { kind: 'malformed', raw, reason: 'invalid-number' };
    return { kind: 'jointPositions', raw, positionsDeg: positions as DummyJointVector };
  }
  return { kind: 'unknown', raw };
}

export interface DummyLineDecoderState {
  buffer: string;
  discardReason: 'overlong' | 'non-ascii' | null;
}

export type DummyDecodedRecord =
  | { kind: 'line'; line: string }
  | { kind: 'discarded'; reason: 'overlong' | 'non-ascii' | 'incomplete'; preview: string };

export interface DummyLineDecodeResult {
  state: DummyLineDecoderState;
  records: DummyDecodedRecord[];
}

export function createDummyLineDecoder(): DummyLineDecoderState {
  return { buffer: '', discardReason: null };
}

export function decodeDummyAsciiChunk(
  initial: DummyLineDecoderState,
  chunk: string
): DummyLineDecodeResult {
  let buffer = initial.buffer;
  let discardReason = initial.discardReason;
  const records: DummyDecodedRecord[] = [];

  for (const character of chunk) {
    if (character === '\r' || character === '\n') {
      if (discardReason) records.push({ kind: 'discarded', reason: discardReason, preview: buffer });
      else if (buffer) records.push({ kind: 'line', line: buffer });
      buffer = '';
      discardReason = null;
      continue;
    }
    if (discardReason) continue;
    if (character.charCodeAt(0) > 0x7f) {
      discardReason = 'non-ascii';
      continue;
    }
    buffer += character;
    if (buffer.length >= DUMMY_ASCII_MAX_LINE_CHARS + 1) discardReason = 'overlong';
  }

  return { state: { buffer, discardReason }, records };
}

export function finishDummyLineDecoder(
  initial: DummyLineDecoderState
): DummyLineDecodeResult {
  const records: DummyDecodedRecord[] = [];
  if (initial.buffer || initial.discardReason) {
    records.push({ kind: 'discarded', reason: initial.discardReason ?? 'incomplete', preview: initial.buffer });
  }
  return { state: createDummyLineDecoder(), records };
}

export function cancelDummyLineDecoder(): DummyLineDecoderState {
  return createDummyLineDecoder();
}

function validateJointGroupLine(line: string): DummyRawCommandValidation {
  const values = line.slice(1).split(',');
  if (values.length !== 6 && values.length !== 7) return invalid('ARGUMENT_COUNT');
  if (values.some((token) => !token.trim() || !Number.isFinite(Number(token)))) return invalid('INVALID_NUMBER');
  if (values.length === 7 && Number(values[6]) <= 0) return invalid('INVALID_NUMBER');
  if (line.length >= DUMMY_ASCII_MOTION_QUEUE_BYTES) return invalid('MOTION_LINE_TOO_LONG');
  return valid('jointGroup', 'high', line);
}

function formatFiniteNumber(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

function assertAllowedMode(mode: number): asserts mode is DummyControlMode {
  if (!isAllowedMode(mode)) throw new Error('Dummy control mode must be 1, 2, or 3');
}

function isAllowedMode(mode: number): mode is DummyControlMode {
  return mode === 1 || mode === 2 || mode === 3;
}

function valid(kind: DummyCommandKind, risk: DummyCommandRisk, normalized: string): DummyRawCommandValidation {
  return { valid: true, code: 'VALID', kind, risk, normalized };
}

function invalid(code: Exclude<DummyCommandValidationCode, 'VALID'>): DummyRawCommandValidation {
  return { valid: false, code, kind: 'invalid', risk: 'low' };
}
