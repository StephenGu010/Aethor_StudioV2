import { describe, expect, it } from 'vitest';
import vectors from '../conformance/aethor-arm-ascii-v1.vectors.json';
import {
  AETHOR_ARM_ASCII_MAX_LINE_BYTES,
  computeAethorArmCrc16Ascii,
  createAethorArmLineDecoder,
  decodeAethorArmAsciiChunk,
  finishAethorArmLineDecoder,
  formatAethorArmRequest,
  parseAethorArmAsciiFrame,
  type AethorArmRequestOperation
} from '../src/aethorArmAsciiV1';

const ascii = (value: string) => new TextEncoder().encode(value);

describe('language-neutral Aethor Arm ASCII v1 conformance vectors', () => {
  it.each(vectors.crcCases)('computes CRC for $body', ({ body, expectedCrc }) => {
    expect(computeAethorArmCrc16Ascii(body).toString(16).toUpperCase().padStart(4, '0')).toBe(expectedCrc);
  });

  it.each(vectors.requestCases)('formats $name', ({ requestId, operation, fields, expectedLine }) => {
    expect(formatAethorArmRequest({
      requestId,
      operation: operation as AethorArmRequestOperation,
      fields: fields.map((pair) => [pair[0]!, pair[1]!] as const)
    })).toBe(expectedLine);
  });

  it.each(vectors.frameCases)('parses $expectedKind frame $expectedSequence', (testCase) => {
    const result = parseAethorArmAsciiFrame(testCase.line);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.frame).toMatchObject({
      kind: testCase.expectedKind,
      sequence: testCase.expectedSequence,
      subject: testCase.expectedSubject
    });
  });

  it.each(vectors.invalidCases)('rejects $line as $expectedCode', ({ line, expectedCode }) => {
    expect(parseAethorArmAsciiFrame(line)).toEqual({ valid: false, code: expectedCode });
  });

  it('decodes fragmented and sticky CRLF/LF records without treating lone CR as a delimiter', () => {
    let state = createAethorArmLineDecoder();
    let result = decodeAethorArmAsciiChunk(state, ascii('REQ 2 GET_'));
    expect(result.records).toHaveLength(0);
    state = result.state;

    result = decodeAethorArmAsciiChunk(state, ascii('JPOS *83EC\r\nERR 0 BAD_CRC *2657\n'));
    expect(result.records).toEqual([
      { kind: 'line', line: 'REQ 2 GET_JPOS *83EC' },
      { kind: 'line', line: 'ERR 0 BAD_CRC *2657' }
    ]);

    result = decodeAethorArmAsciiChunk(result.state, ascii('REQ 2\rGET_JPOS *83EC\n'));
    expect(result.records).toEqual([{ kind: 'discarded', reason: 'control-character', preview: 'REQ 2' }]);
  });

  it('decodes a valid frame at every possible byte split', () => {
    const line = 'TEL 4294967295 JOINT_STATE t_us=183920040 q_deg=0,-15.012,0,0.004,20.001,0,4.995 present_mask=0x5B valid_mask=0x5B conflict_mask=0x00 unexpected_ids=none *9A9B';
    const bytes = ascii(`${line}\n`);
    for (let split = 0; split <= bytes.length; split += 1) {
      const first = decodeAethorArmAsciiChunk(createAethorArmLineDecoder(), bytes.slice(0, split));
      const second = decodeAethorArmAsciiChunk(first.state, bytes.slice(split));
      expect([...first.records, ...second.records], `split ${split}`).toEqual([{ kind: 'line', line }]);
    }
  });

  it('bounds malformed input and reports an incomplete tail', () => {
    let result = decodeAethorArmAsciiChunk(
      createAethorArmLineDecoder(),
      ascii(`${'A'.repeat(AETHOR_ARM_ASCII_MAX_LINE_BYTES + 32)}\n`)
    );
    expect(result.records).toEqual([{
      kind: 'discarded',
      reason: 'overlong',
      preview: 'A'.repeat(AETHOR_ARM_ASCII_MAX_LINE_BYTES)
    }]);

    result = decodeAethorArmAsciiChunk(result.state, Uint8Array.from([0x52, 0x45, 0x51, 0xff, 0x0a]));
    expect(result.records).toEqual([{ kind: 'discarded', reason: 'non-ascii', preview: 'REQ' }]);

    result = decodeAethorArmAsciiChunk(result.state, ascii('partial'));
    expect(finishAethorArmLineDecoder(result.state).records).toEqual([
      { kind: 'discarded', reason: 'incomplete', preview: 'partial' }
    ]);
  });
});
