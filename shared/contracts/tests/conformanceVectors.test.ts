import { describe, expect, it } from 'vitest';
import vectors from '../conformance/dummy-ascii-v1.vectors.json';
import {
  formatDummyCommand,
  parseDummyResponseLine,
  validateDummyRawCommand,
  type DummyStructuredCommand
} from '../src/dummyAsciiV1';

describe('language-neutral Dummy ASCII v1 conformance vectors', () => {
  it.each(vectors.formatCases)('$name', ({ command, expectedLine }) => {
    expect(formatDummyCommand(command as DummyStructuredCommand)).toBe(expectedLine);
  });

  it.each(vectors.invalidRawCases)('rejects $raw', ({ raw, expectedCode }) => {
    expect(validateDummyRawCommand(raw)).toMatchObject({ valid: false, code: expectedCode });
  });

  it.each(vectors.responseCases)('parses $raw', ({ raw, expectedKind }) => {
    expect(parseDummyResponseLine(raw).kind).toBe(expectedKind);
  });
});
