import { describe, expect, it } from 'vitest';
import {
  DUMMY_ASCII_MAX_LINE_CHARS,
  cancelDummyLineDecoder,
  createDummyLineDecoder,
  decodeDummyAsciiChunk,
  encodeDummyCommand,
  finishDummyLineDecoder,
  formatDummyCommand,
  formatDummySafetyZeroCurrent,
  parseDummyResponseLine,
  validateDummyRawCommand
} from '../src/dummyAsciiV1';

describe('Dummy ASCII v1 command formatter and whitelist', () => {
  it('formats only the approved structured command set', () => {
    expect(formatDummyCommand({ type: 'queryJointPositions' })).toBe('#GETJPOS');
    expect(formatDummyCommand({ type: 'setMode', mode: 3 })).toBe('#CMDMODE 3');
    expect(formatDummyCommand({ type: 'jointGroup', positionsDeg: [0, -1.25, 2, 3, 4, 5], speedDegS: 10 })).toBe(
      '>0,-1.25,2,3,4,5,10'
    );
    expect(encodeDummyCommand({ type: 'stop' })).toBe('!STOP\n');
    expect(formatDummySafetyZeroCurrent()).toBe('$0,0,0,0,0,0');
    expect(validateDummyRawCommand(formatDummySafetyZeroCurrent()).valid).toBe(false);
  });

  it('rejects invalid motion values and modes outside 1..3', () => {
    expect(() => formatDummyCommand({ type: 'setMode', mode: 5 as 3 })).toThrow(/1, 2, or 3/);
    expect(() => formatDummyCommand({ type: 'jointGroup', positionsDeg: [0, 1] })).toThrow(/six/);
    expect(() => formatDummyCommand({ type: 'jointGroup', positionsDeg: [0, 1, 2, 3, 4, Number.NaN] })).toThrow(/finite/);
    expect(() => formatDummyCommand({ type: 'jointGroup', positionsDeg: [0, 1, 2, 3, 4, 5], speedDegS: 0 })).toThrow(/greater/);
  });

  it.each([
    '#CMDMODE 4', '#CMDMODE 5', '#RGBMODE 1', '#RGBCOLOR 1 2 3', '!CALIBRATION',
    '#SET_DCE_KP 1 2', '#REBOOT 1', '@0,0,0,0,0,0', '&0,0,0,0,0,0', '$0,0,0,0,0,0', '!NOTSTOP'
  ])('does not admit excluded raw command %s', (command) => {
    expect(validateDummyRawCommand(command).valid).toBe(false);
  });

  it('accepts exact approved raw commands and bounded six-joint groups', () => {
    expect(validateDummyRawCommand('#GETENABLE')).toMatchObject({ valid: true, kind: 'query', risk: 'low' });
    expect(validateDummyRawCommand('#CMDMODE 2')).toMatchObject({ valid: true, kind: 'mode', risk: 'high' });
    expect(validateDummyRawCommand('>0,1,2,3,4,5,10')).toMatchObject({ valid: true, kind: 'jointGroup', risk: 'high' });
    expect(validateDummyRawCommand('>0,1,2')).toMatchObject({ valid: false, code: 'ARGUMENT_COUNT' });
  });
});

describe('Dummy ASCII v1 response parser', () => {
  it.each([
    ['Started ok', 'systemAck'],
    ['Stopped ok', 'systemAck'],
    ['Disabled ok', 'systemAck'],
    ['Homing ok', 'systemAck'],
    ['ok', 'genericAck'],
    ['ok 0', 'enable'],
    ['ok 1 SEQ_POINT', 'mode'],
    ['ok Set command mode to [3] (CONT_TRAJ)', 'modeAck'],
    ['ok 1.00 -2.50 3.00 4.25 5.00 6.00', 'jointPositions'],
    ['15', 'queue'],
    ['error CMD FIFO FULL', 'error']
  ])('parses firmware sample %s', (line, kind) => {
    expect(parseDummyResponseLine(line).kind).toBe(kind);
  });

  it('keeps unsupported modes, malformed numbers, FIFO sentinel and unknown lines explicit', () => {
    expect(parseDummyResponseLine('ok 5 COMP_CURRENT')).toMatchObject({ kind: 'unsupportedMode', mode: 5 });
    expect(parseDummyResponseLine('ok 1 2 BAD 4 5 6')).toMatchObject({ kind: 'malformed', reason: 'invalid-number' });
    expect(parseDummyResponseLine('255')).toMatchObject({ kind: 'queue', accepted: false, freeSlots: 255 });
    expect(parseDummyResponseLine('16')).toMatchObject({ kind: 'malformed', reason: 'invalid-queue-value' });
    expect(parseDummyResponseLine('firmware banner')).toMatchObject({ kind: 'unknown' });
  });
});

describe('Dummy ASCII v1 bounded line decoder', () => {
  it('produces the same lines for random fragmentation and sticky packets', () => {
    const payload = 'ok 1\r\nok 1 SEQ_POINT\n15\nerror CMD FIFO FULL\r\n';
    const expected = ['ok 1', 'ok 1 SEQ_POINT', '15', 'error CMD FIFO FULL'];
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = createDummyLineDecoder();
      const lines: string[] = [];
      let offset = 0;
      let value = seed;
      while (offset < payload.length) {
        value = (value * 48271) % 0x7fffffff;
        const size = 1 + (value % 7);
        const result = decodeDummyAsciiChunk(state, payload.slice(offset, offset + size));
        state = result.state;
        lines.push(...result.records.filter((record) => record.kind === 'line').map((record) => record.line));
        offset += size;
      }
      expect(lines).toEqual(expected);
      expect(state).toEqual(createDummyLineDecoder());
    }
  });

  it('drops empty, non-ASCII and firmware-overlong lines without retaining unbounded input', () => {
    let result = decodeDummyAsciiChunk(createDummyLineDecoder(), '\n\r\n');
    expect(result.records).toEqual([]);
    result = decodeDummyAsciiChunk(result.state, `${'a'.repeat(DUMMY_ASCII_MAX_LINE_CHARS)}\n`);
    expect(result.records).toEqual([{ kind: 'line', line: 'a'.repeat(DUMMY_ASCII_MAX_LINE_CHARS) }]);
    result = decodeDummyAsciiChunk(result.state, `${'b'.repeat(DUMMY_ASCII_MAX_LINE_CHARS + 1)}tail\n`);
    expect(result.records[0]).toMatchObject({ kind: 'discarded', reason: 'overlong' });
    expect(result.state.buffer).toBe('');
    result = decodeDummyAsciiChunk(result.state, 'ok 中\n');
    expect(result.records[0]).toMatchObject({ kind: 'discarded', reason: 'non-ascii' });
  });

  it('reports an incomplete line on disconnect and clears state on cancellation', () => {
    const partial = decodeDummyAsciiChunk(createDummyLineDecoder(), 'ok 1');
    expect(finishDummyLineDecoder(partial.state).records).toEqual([
      { kind: 'discarded', reason: 'incomplete', preview: 'ok 1' }
    ]);
    expect(cancelDummyLineDecoder()).toEqual(createDummyLineDecoder());
  });
});
