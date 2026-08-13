export const AETHOR_ARM_ASCII_PROTOCOL_ID = 'aethor-arm-ascii-v1';
export const AETHOR_ARM_ASCII_MAX_LINE_BYTES = 512;
export const AETHOR_ARM_ASCII_LINE_ENDING = '\n';
export const AETHOR_ARM_JOINT_COUNT = 7;
export const UINT32_MAX = 4_294_967_295;

export const AETHOR_ARM_REQUEST_OPERATIONS = [
  'HELLO',
  'GET_INFO',
  'GET_CONFIG',
  'GET_STATE',
  'GET_JPOS',
  'GET_MOTORS',
  'GET_DIAG',
  'HEARTBEAT',
  'SET_STREAM',
  'ALIGN_REFERENCE',
  'ENABLE',
  'STOP',
  'DISABLE',
  'CLEAR_FAULT',
  'MOVE_JOINTS'
] as const;

export type AethorArmRequestOperation = typeof AETHOR_ARM_REQUEST_OPERATIONS[number];
export type AethorArmFrameKind = 'REQ' | 'ACK' | 'RSP' | 'ERR' | 'DONE' | 'EVT' | 'TEL';
export type AethorArmAsciiValidationCode =
  | 'VALID'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'MULTILINE'
  | 'NON_ASCII'
  | 'BAD_FRAME'
  | 'BAD_CRC'
  | 'UNKNOWN_OPERATION'
  | 'SEQUENCE_OUT_OF_RANGE';

export interface AethorArmAsciiFrame {
  kind: AethorArmFrameKind;
  sequence: number;
  subject: string;
  fields: Readonly<Record<string, string>>;
  body: string;
  raw: string;
  crc16: number;
}

export type AethorArmAsciiParseResult =
  | { valid: true; code: 'VALID'; frame: AethorArmAsciiFrame }
  | { valid: false; code: Exclude<AethorArmAsciiValidationCode, 'VALID'> };

export interface AethorArmRequest {
  requestId: number;
  operation: AethorArmRequestOperation;
  fields?: ReadonlyArray<readonly [key: string, value: string]>;
}

const requestOperations = new Set<string>(AETHOR_ARM_REQUEST_OPERATIONS);
const frameKinds = new Set<string>(['REQ', 'ACK', 'RSP', 'ERR', 'DONE', 'EVT', 'TEL']);
const upperTokenPattern = /^[A-Z][A-Z0-9_]*$/;
const fieldKeyPattern = /^[a-z][a-z0-9_]*$/;

export function computeAethorArmCrc16Ascii(body: string): number {
  assertPrintableAscii(body, 'CRC body');
  let crc = 0xffff;
  for (let index = 0; index < body.length; index += 1) {
    crc ^= body.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function formatAethorArmRequest(request: AethorArmRequest): string {
  if (!Number.isInteger(request.requestId) || request.requestId < 1 || request.requestId > UINT32_MAX) {
    throw new RangeError('Aethor requestId must be in 1..4294967295');
  }
  if (!requestOperations.has(request.operation)) {
    throw new Error(`Unsupported Aethor Arm operation: ${request.operation}`);
  }

  const tokens = ['REQ', String(request.requestId), request.operation];
  const keys = new Set<string>();
  for (const [key, value] of request.fields ?? []) {
    assertField(key, value, keys);
    tokens.push(`${key}=${value}`);
  }
  const body = tokens.join(' ');
  const line = `${body} *${formatCrc(computeAethorArmCrc16Ascii(body))}`;
  if (line.length > AETHOR_ARM_ASCII_MAX_LINE_BYTES) {
    throw new RangeError(`Aethor Arm frame exceeds ${AETHOR_ARM_ASCII_MAX_LINE_BYTES} ASCII bytes`);
  }
  return line;
}

export function encodeAethorArmRequest(request: AethorArmRequest): string {
  return `${formatAethorArmRequest(request)}${AETHOR_ARM_ASCII_LINE_ENDING}`;
}

export function parseAethorArmAsciiFrame(input: string): AethorArmAsciiParseResult {
  if (!input) return invalid('EMPTY');
  if (input.includes('\r') || input.includes('\n')) return invalid('MULTILINE');
  if (input.length > AETHOR_ARM_ASCII_MAX_LINE_BYTES) return invalid('TOO_LONG');
  if (!isPrintableAscii(input)) return invalid('NON_ASCII');

  const crcMarker = input.length - 6;
  if (crcMarker <= 0 || input[crcMarker] !== ' ' || input[crcMarker + 1] !== '*') return invalid('BAD_FRAME');
  const crcText = input.slice(-4);
  if (!/^[0-9A-F]{4}$/.test(crcText)) return invalid('BAD_FRAME');
  const body = input.slice(0, crcMarker);
  if (body.includes('*')) return invalid('BAD_FRAME');
  const suppliedCrc = Number.parseInt(crcText, 16);
  if (computeAethorArmCrc16Ascii(body) !== suppliedCrc) return invalid('BAD_CRC');

  const tokens = body.split(' ');
  if (tokens.length < 3 || tokens.some((token) => token.length === 0)) return invalid('BAD_FRAME');
  const kindToken = tokens[0]!;
  if (!frameKinds.has(kindToken)) return invalid('BAD_FRAME');
  const kind = kindToken as AethorArmFrameKind;
  const sequenceToken = tokens[1]!;
  if (!/^\d{1,10}$/.test(sequenceToken)) return invalid('BAD_FRAME');
  const sequence = Number(sequenceToken);
  if (!Number.isSafeInteger(sequence) || sequence > UINT32_MAX || (requiresNonZeroSequence(kind) && sequence === 0)) {
    return invalid('SEQUENCE_OUT_OF_RANGE');
  }

  const subject = tokens[2]!;
  if (!isValidSubject(kind, subject)) return invalid('BAD_FRAME');
  if (kind === 'REQ' && !requestOperations.has(subject)) return invalid('UNKNOWN_OPERATION');

  const fields: Record<string, string> = {};
  for (const token of tokens.slice(3)) {
    const separator = token.indexOf('=');
    if (separator <= 0 || separator === token.length - 1 || token.indexOf('=', separator + 1) >= 0) {
      return invalid('BAD_FRAME');
    }
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (!fieldKeyPattern.test(key) || /[\s*=]/.test(value)) return invalid('BAD_FRAME');
    if (Object.hasOwn(fields, key)) return invalid('BAD_FRAME');
    fields[key] = value;
  }

  return {
    valid: true,
    code: 'VALID',
    frame: { kind, sequence, subject, fields: Object.freeze(fields), body, raw: input, crc16: suppliedCrc }
  };
}

export interface AethorArmLineDecoderState {
  buffer: string;
  pendingCr: boolean;
  discardReason: 'overlong' | 'non-ascii' | 'control-character' | null;
}

export type AethorArmDecodedRecord =
  | { kind: 'line'; line: string }
  | { kind: 'discarded'; reason: 'overlong' | 'non-ascii' | 'control-character' | 'incomplete'; preview: string };

export interface AethorArmLineDecodeResult {
  state: AethorArmLineDecoderState;
  records: AethorArmDecodedRecord[];
}

export function createAethorArmLineDecoder(): AethorArmLineDecoderState {
  return { buffer: '', pendingCr: false, discardReason: null };
}

export function decodeAethorArmAsciiChunk(
  initial: AethorArmLineDecoderState,
  chunk: Uint8Array
): AethorArmLineDecodeResult {
  let { buffer, pendingCr, discardReason } = initial;
  const records: AethorArmDecodedRecord[] = [];

  const finishRecord = () => {
    if (discardReason) records.push({ kind: 'discarded', reason: discardReason, preview: buffer });
    else if (buffer) records.push({ kind: 'line', line: buffer });
    buffer = '';
    pendingCr = false;
    discardReason = null;
  };

  for (const value of chunk) {
    if (value === 0x0a) {
      finishRecord();
      continue;
    }
    if (discardReason) continue;
    if (pendingCr) {
      discardReason = 'control-character';
      continue;
    }
    if (value === 0x0d) {
      pendingCr = true;
      continue;
    }
    if (value < 0x20 || value > 0x7e) {
      discardReason = value > 0x7f ? 'non-ascii' : 'control-character';
      continue;
    }
    buffer += String.fromCharCode(value);
    if (buffer.length > AETHOR_ARM_ASCII_MAX_LINE_BYTES) {
      buffer = buffer.slice(0, AETHOR_ARM_ASCII_MAX_LINE_BYTES);
      discardReason = 'overlong';
    }
  }

  return { state: { buffer, pendingCr, discardReason }, records };
}

export function finishAethorArmLineDecoder(initial: AethorArmLineDecoderState): AethorArmLineDecodeResult {
  const records: AethorArmDecodedRecord[] = [];
  if (initial.buffer || initial.pendingCr || initial.discardReason) {
    records.push({
      kind: 'discarded',
      reason: initial.discardReason ?? 'incomplete',
      preview: initial.buffer
    });
  }
  return { state: createAethorArmLineDecoder(), records };
}

function assertField(key: string, value: string, keys: Set<string>) {
  if (!fieldKeyPattern.test(key)) throw new Error(`Invalid Aethor Arm field key: ${key}`);
  if (!value || /[\s*=]/.test(value) || !isPrintableAscii(value)) {
    throw new Error(`Invalid Aethor Arm field value for ${key}`);
  }
  if (keys.has(key)) throw new Error(`Duplicate Aethor Arm field: ${key}`);
  keys.add(key);
}

function requiresNonZeroSequence(kind: AethorArmFrameKind) {
  return kind === 'REQ' || kind === 'ACK' || kind === 'RSP' || kind === 'DONE';
}

function isValidSubject(kind: AethorArmFrameKind, subject: string) {
  if (kind === 'ACK') return subject === 'accepted';
  if (kind === 'RSP') return subject === 'ok';
  return upperTokenPattern.test(subject);
}

function formatCrc(crc: number) {
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function assertPrintableAscii(value: string, label: string) {
  if (!isPrintableAscii(value)) throw new Error(`${label} must contain printable ASCII only`);
}

function isPrintableAscii(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function invalid(code: Exclude<AethorArmAsciiValidationCode, 'VALID'>): AethorArmAsciiParseResult {
  return { valid: false, code };
}
