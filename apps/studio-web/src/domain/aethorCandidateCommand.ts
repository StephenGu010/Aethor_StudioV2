import type { CommandValidation } from './dummyCommand';

const MAXIMUM_LINE_CHARACTERS = 512;
const UINT32_MAX = 4_294_967_295;

const operations = new Map<string, { kind: string; risk: CommandValidation['risk'] }>([
  ['HELLO', { kind: 'HANDSHAKE', risk: 'low' }],
  ['GET_INFO', { kind: 'QUERY', risk: 'low' }],
  ['GET_CONFIG', { kind: 'QUERY', risk: 'low' }],
  ['GET_STATE', { kind: 'QUERY', risk: 'low' }],
  ['GET_JPOS', { kind: 'QUERY', risk: 'low' }],
  ['GET_MOTORS', { kind: 'QUERY', risk: 'low' }],
  ['SET_STREAM', { kind: 'STREAM', risk: 'medium' }],
  ['ENABLE', { kind: 'SYSTEM', risk: 'high' }],
  ['STOP', { kind: 'SYSTEM', risk: 'high' }],
  ['DISABLE', { kind: 'SYSTEM', risk: 'high' }],
  ['SET_MODE', { kind: 'MODE', risk: 'high' }],
  ['MOVE_JOINTS', { kind: 'JOINT GROUP', risk: 'high' }]
]);

export function validateAethorCandidateCommand(raw: string): CommandValidation {
  const normalized = raw.trim();
  if (!normalized) return invalid('命令不能为空');
  if (raw.includes('\n') || raw.includes('\r')) return invalid('每次只校验一条候选协议帧');
  if ([...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code > 0x7e;
  })) {
    return invalid('候选协议只允许可打印 ASCII 字符');
  }
  if (normalized.length > MAXIMUM_LINE_CHARACTERS) return invalid('命令超过候选协议 512-byte 行长边界');

  const match = /^REQ\s+([1-9]\d{0,9})\s+([A-Z][A-Z0-9_]*)(?:\s+.*?)?\s+\*(<CRC16>|[0-9A-Fa-f]{4})$/.exec(normalized);
  if (!match) return invalid('格式应为 REQ <id> <operation> [key=value ...] *<CRC16>');

  const requestId = Number(match[1]);
  if (!Number.isSafeInteger(requestId) || requestId > UINT32_MAX) {
    return invalid('request_id 必须位于 1…4294967295');
  }

  const operation = operations.get(match[2]!);
  if (!operation) return invalid('operation 不在 Aethor Arm v1 候选白名单中');

  const hasPlaceholderCrc = match[3] === '<CRC16>';
  return {
    valid: true,
    kind: operation.kind,
    risk: operation.risk,
    message: hasPlaceholderCrc
      ? '候选请求模板格式有效；CRC 测试向量冻结后由独立 codec 填充'
      : '候选请求包络有效；当前软件门不把 CRC 文本认定为已通过固件一致性校验'
  };
}

function invalid(message: string): CommandValidation {
  return { valid: false, kind: 'INVALID', message, risk: 'low' };
}
