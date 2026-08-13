import {
  formatAethorArmRequest,
  parseAethorArmAsciiFrame,
  type AethorArmRequest,
  type AethorArmRequestOperation
} from '@aethor/contracts/aethor-arm-ascii-v1';
import type { CommandValidation } from './dummyCommand';

const operationPolicy = new Map<AethorArmRequestOperation, {
  kind: string;
  risk: CommandValidation['risk'];
}>([
  ['HELLO', { kind: 'HANDSHAKE', risk: 'low' }],
  ['GET_INFO', { kind: 'QUERY', risk: 'low' }],
  ['GET_CONFIG', { kind: 'QUERY', risk: 'low' }],
  ['GET_STATE', { kind: 'QUERY', risk: 'low' }],
  ['GET_JPOS', { kind: 'QUERY', risk: 'low' }],
  ['GET_MOTORS', { kind: 'QUERY', risk: 'low' }],
  ['GET_DIAG', { kind: 'QUERY', risk: 'low' }],
  ['HEARTBEAT', { kind: 'HEARTBEAT', risk: 'low' }],
  ['SET_STREAM', { kind: 'STREAM', risk: 'medium' }],
  ['ALIGN_REFERENCE', { kind: 'REFERENCE', risk: 'high' }],
  ['ENABLE', { kind: 'SYSTEM', risk: 'high' }],
  ['STOP', { kind: 'SYSTEM', risk: 'high' }],
  ['DISABLE', { kind: 'SYSTEM', risk: 'high' }],
  ['CLEAR_FAULT', { kind: 'SYSTEM', risk: 'high' }],
  ['MOVE_JOINTS', { kind: 'JOINT GROUP', risk: 'high' }]
]);

export function formatAethorCandidateRequest(request: AethorArmRequest) {
  return formatAethorArmRequest(request);
}

export function validateAethorCandidateCommand(raw: string): CommandValidation {
  if (raw !== raw.trim()) return invalid('帧首尾不能包含空格；CRC 覆盖精确 ASCII body');
  const parsed = parseAethorArmAsciiFrame(raw);
  if (!parsed.valid) return invalid(validationMessages[parsed.code]);
  if (parsed.frame.kind !== 'REQ') return invalid('终端输入只接受 REQ 请求帧');

  const operation = parsed.frame.subject as AethorArmRequestOperation;
  const policy = operationPolicy.get(operation);
  if (!policy) return invalid('operation 不在 Aethor Arm v1 软件白名单中');
  return {
    valid: true,
    kind: policy.kind,
    risk: policy.risk,
    message: `CRC VERIFIED · request ${parsed.frame.sequence} · ${operation}`
  };
}

const validationMessages = {
  EMPTY: '命令不能为空',
  TOO_LONG: '命令超过 Aethor Arm v1 的 512-byte 行长边界',
  MULTILINE: '每次只校验一条 Aethor Arm 协议帧',
  NON_ASCII: '协议只允许可打印 ASCII 字符',
  BAD_FRAME: '帧结构、字段语法或大写 CRC 文本不符合 Aethor Arm v1',
  BAD_CRC: 'CRC-16/CCITT-FALSE 校验失败',
  UNKNOWN_OPERATION: 'operation 不在 Aethor Arm v1 软件白名单中',
  SEQUENCE_OUT_OF_RANGE: 'request_id 必须位于 1…4294967295'
} as const;

function invalid(message: string): CommandValidation {
  return { valid: false, kind: 'INVALID', message, risk: 'low' };
}
