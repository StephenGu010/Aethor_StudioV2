import { validateDummyRawCommand } from '@aethor/contracts/dummy-ascii-v1';

export interface CommandValidation {
  valid: boolean;
  kind: string;
  message: string;
  risk: 'low' | 'medium' | 'high';
}

const invalidMessages = {
  EMPTY: '命令不能为空',
  TOO_LONG: '命令超过 Dummy 固件行长度上限',
  MULTILINE: '每次只能校验一条命令',
  NON_ASCII: '命令只能包含可打印 ASCII 字符',
  MODE_NOT_ALLOWED: 'Aethor Studio V2 仅允许 Dummy 模式 1–3',
  COMMAND_NOT_ALLOWED: '命令不在 V2 结构化白名单内',
  ARGUMENT_COUNT: '关节组命令必须包含六个关节值和可选速度',
  INVALID_NUMBER: '关节组命令包含非法数值或非正速度',
  MOTION_LINE_TOO_LONG: '运动命令超过固件 FIFO 单项容量'
} as const;

const kindNames = {
  system: 'SYSTEM',
  query: 'QUERY',
  mode: 'MODE',
  jointGroup: 'JOINT GROUP'
} as const;

export function validateDummyCommand(raw: string): CommandValidation {
  const validation = validateDummyRawCommand(raw);
  if (!validation.valid || validation.kind === 'invalid') {
    return {
      valid: false,
      kind: 'INVALID',
      message: invalidMessages[validation.code as keyof typeof invalidMessages] ?? '命令格式无效',
      risk: 'low'
    };
  }
  const message = validation.kind === 'query'
    ? '只读查询格式有效；离线状态不会发送'
    : '命令格式有效；真实发送仍需后端权限与安全门';
  return { valid: true, kind: kindNames[validation.kind], message, risk: validation.risk };
}
