import { describe, expect, it } from 'vitest';
import { validateAethorCandidateCommand } from './aethorCandidateCommand';

describe('validateAethorCandidateCommand', () => {
  it('accepts documented request templates without claiming CRC conformance', () => {
    expect(validateAethorCandidateCommand('REQ 42 GET_JPOS *<CRC16>')).toMatchObject({
      valid: true,
      kind: 'QUERY',
      risk: 'low'
    });
    expect(validateAethorCandidateCommand('REQ 43 STOP behavior=controlled *A10F')).toMatchObject({
      valid: true,
      kind: 'SYSTEM',
      risk: 'high'
    });
  });

  it('rejects invalid identity, unknown operations, multiline and non-ASCII input', () => {
    expect(validateAethorCandidateCommand('REQ 0 GET_JPOS *<CRC16>').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 4294967296 GET_JPOS *<CRC16>').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 1 REBOOT *<CRC16>').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 1 GET_JPOS *<CRC16>\nREQ 2 GET_STATE *<CRC16>').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 1 GET_JPOS 角度=1 *<CRC16>').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ\t1 GET_JPOS *<CRC16>').valid).toBe(false);
  });
});
