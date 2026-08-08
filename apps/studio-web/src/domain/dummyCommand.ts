export interface CommandValidation {
  valid: boolean;
  kind: string;
  message: string;
  risk: 'low' | 'medium' | 'high';
}

const bangCommands = new Set([
  '!START', '!STOP', '!DISABLE', '!HOME', '!RESET', '!CALIBRATION',
  '!LEDON', '!LEDOFF', '!RGBON', '!RGBOFF'
]);
const queryCommands = new Set(['#GETJPOS', '#GETLPOS', '#GETMODE', '#GETENABLE', '#GETRGB']);

export function validateDummyCommand(raw: string): CommandValidation {
  const command = raw.trim();
  if (!command) return invalid('命令不能为空');
  if (command.length > 256) return invalid('命令超过 256 字符');
  if (!/^[\x20-\x7E]+$/.test(command)) return invalid('命令只能包含可打印 ASCII 字符');

  if (bangCommands.has(command)) {
    const highRisk = ['!STOP', '!DISABLE', '!HOME', '!CALIBRATION'].includes(command);
    return valid('SYSTEM', highRisk ? '系统控制命令；真实发送需要后端确认' : '系统控制命令格式有效', highRisk ? 'high' : 'medium');
  }
  if (queryCommands.has(command)) return valid('QUERY', '状态查询命令格式有效', 'low');
  if (/^#CMDMODE [1-5]$/.test(command)) return valid('MODE', '控制模式命令格式有效', 'medium');
  if (/^#RGBMODE [0-7]$/.test(command)) return valid('RGB', 'RGB 模式命令格式有效', 'low');
  if (/^#RGBCOLOR (?:\d{1,3} ){2}\d{1,3}$/.test(command)) {
    const channels = command.split(' ').slice(1).map(Number);
    return channels.every((value) => value >= 0 && value <= 255)
      ? valid('RGB', 'RGB 颜色命令格式有效', 'low')
      : invalid('RGB 通道必须在 0..255');
  }
  if (/^#(?:SET_DCE_KP|SET_DCE_KI|SET_DCE_KD) [1-6] -?\d+(?:\.\d+)?$/.test(command)) {
    return valid('MOTOR_TUNE', '电机维护命令格式有效；真实发送属于高风险操作', 'high');
  }
  if (/^#REBOOT [1-6]$/.test(command)) return valid('MOTOR_REBOOT', '电机重启命令格式有效；真实发送属于高风险操作', 'high');

  const prefix = command[0];
  if (prefix === '>' || prefix === '&' || prefix === '@' || prefix === '$') {
    const expected = prefix === '$' ? 6 : [6, 7];
    const values = command.slice(1).split(',').map((value) => Number(value.trim()));
    const lengthValid = Array.isArray(expected) ? expected.includes(values.length) : values.length === expected;
    if (!lengthValid || values.some((value) => !Number.isFinite(value))) return invalid('运动/电流流命令参数数量或数字格式无效');
    return valid(prefix === '$' ? 'CURRENT_STREAM' : 'MOTION_STREAM', '流命令格式有效；离线状态不会发送', 'high');
  }
  return invalid('未识别的 Dummy ASCII v1 命令');
}

function valid(kind: string, message: string, risk: CommandValidation['risk']): CommandValidation {
  return { valid: true, kind, message, risk };
}

function invalid(message: string): CommandValidation {
  return { valid: false, kind: 'INVALID', message, risk: 'low' };
}

