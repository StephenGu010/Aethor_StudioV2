import { describe, expect, it } from 'vitest';
import { validateDummyCommand } from './dummyCommand';

describe('Dummy ASCII v1 validation', () => {
  it.each(['#GETJPOS', '#GETMODE', '#CMDMODE 5', '#RGBMODE 7', '#RGBCOLOR 255 0 32'])(
    'accepts canonical command %s',
    (command) => expect(validateDummyCommand(command).valid).toBe(true)
  );

  it('labels motion and stop operations as high risk', () => {
    expect(validateDummyCommand('!STOP').risk).toBe('high');
    expect(validateDummyCommand('>0,0,0,0,0,0,10').risk).toBe('high');
  });

  it.each(['#CMDMODE 6', '#RGBCOLOR 256 0 0', '中文命令', '>0,0,0'])(
    'rejects invalid command %s',
    (command) => expect(validateDummyCommand(command).valid).toBe(false)
  );
});
