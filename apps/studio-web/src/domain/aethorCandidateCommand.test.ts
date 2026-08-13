import { describe, expect, it } from 'vitest';
import { formatAethorCandidateRequest, validateAethorCandidateCommand } from './aethorCandidateCommand';

describe('validateAethorCandidateCommand', () => {
  it('formats and accepts CRC-verified requests', () => {
    const query = formatAethorCandidateRequest({ requestId: 42, operation: 'GET_JPOS' });
    const stop = formatAethorCandidateRequest({
      requestId: 43,
      operation: 'STOP',
      fields: [['behavior', 'controlled']]
    });
    expect(validateAethorCandidateCommand(query)).toMatchObject({
      valid: true,
      kind: 'QUERY',
      risk: 'low',
      message: 'CRC VERIFIED · request 42 · GET_JPOS'
    });
    expect(validateAethorCandidateCommand(stop)).toMatchObject({
      valid: true,
      kind: 'SYSTEM',
      risk: 'high'
    });
  });

  it('rejects invalid identity, unknown operations, multiline and non-ASCII input', () => {
    expect(validateAethorCandidateCommand('REQ 0 GET_JPOS *5D66').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 4294967296 GET_JPOS *D95B').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 1 REBOOT *47C5').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 1 GET_JPOS *8A1D\nREQ 2 GET_STATE *D9AA').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 1 GET_JPOS 角度=1 *0000').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ\t1 GET_JPOS *0000').valid).toBe(false);
    expect(validateAethorCandidateCommand('REQ 2 GET_JPOS *0000')).toMatchObject({
      valid: false,
      message: 'CRC-16/CCITT-FALSE 校验失败'
    });
  });
});
