import { describe, expect, it } from 'vitest';
import { validateDummyCommand } from './dummyCommand';

describe('Dummy ASCII v1 validation', () => {
  it.each(['#GETJPOS', '#GETMODE', '#GETENABLE', '#CMDMODE 1', '#CMDMODE 2', '#CMDMODE 3'])(
    'accepts canonical command %s',
    (command) => expect(validateDummyCommand(command).valid).toBe(true)
  );

  it('labels motion and stop operations as high risk', () => {
    expect(validateDummyCommand('!STOP').risk).toBe('high');
    expect(validateDummyCommand('>0,0,0,0,0,0,10').risk).toBe('high');
  });

  it.each([
    '#CMDMODE 4', '#CMDMODE 5', '#RGBMODE 7', '#RGBCOLOR 255 0 32', '!CALIBRATION',
    '#SET_DCE_KP 1 10', '#REBOOT 1', '@0,0,0,0,0,0', '&0,0,0,0,0,0', '$0,0,0,0,0,0',
    '中文命令', '>0,0,0'
  ])(
    'rejects invalid command %s',
    (command) => expect(validateDummyCommand(command).valid).toBe(false)
  );
});
