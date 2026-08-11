import type { ActionProgramV1 } from '@aethor/contracts';
import { describe, expect, it } from 'vitest';
import { dummyProfile } from '../profile/dummyProfile';
import {
  createActionProgramV1,
  createActionWaypointV1,
  parseActionProgramJson,
  serializeActionProgramV1,
  validateActionProgramV1
} from './actionProgram';

const timestampUtc = '2026-08-09T00:00:00.000Z';

describe('ActionProgramV1 domain', () => {
  it('round-trips a bounded six-axis program without changing its provenance', () => {
    const program = validProgram();
    const serialized = serializeActionProgramV1(program, dummyProfile);
    const parsed = parseActionProgramJson(serialized, dummyProfile);

    expect(parsed).toMatchObject({ valid: true, program });
    expect(parsed.program).not.toBe(program);
    expect(parsed.program?.waypoints[0]).not.toBe(program.waypoints[0]);
  });

  it('rejects unknown versions instead of silently rewriting them', () => {
    const result = validateActionProgramV1({ ...validProgram(), schemaVersion: '2.0' }, dummyProfile);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/不支持.*版本|不会静默迁移/);
  });

  it('rejects documents that do not declare the Dummy device-angle coordinate system', () => {
    const program = validProgram();
    const { jointCoordinateSystem: _jointCoordinateSystem, ...legacyProgram } = program;
    expect(validateActionProgramV1(legacyProgram, dummyProfile).valid).toBe(false);
    expect(validateActionProgramV1({ ...program, jointCoordinateSystem: 'urdf-model-joints' }, dummyProfile).valid).toBe(false);
  });

  it('rejects wrong DOF, unsupported modes, duplicate IDs, and joint-limit violations', () => {
    const program = validProgram();
    const waypoint = program.waypoints[0]!;
    expect(validateActionProgramV1({
      ...program,
      waypoints: [{ ...waypoint, positionsDeg: [0, 0, 0, 0, 0] }]
    }, dummyProfile).valid).toBe(false);
    expect(validateActionProgramV1({
      ...program,
      waypoints: [{ ...waypoint, mode: 5 }]
    }, dummyProfile).valid).toBe(false);
    expect(validateActionProgramV1({
      ...program,
      waypoints: [waypoint, { ...waypoint }]
    }, dummyProfile).errors.join(' ')).toMatch(/waypointId 重复/);
    expect(validateActionProgramV1({
      ...program,
      waypoints: [{ ...waypoint, positionsDeg: [181, 0, 0, 0, 0, 0] }]
    }, dummyProfile).errors.join(' ')).toMatch(/J1 超出/);
  });

  it('requires measured captures to carry a UTC timestamp and prevents false capture metadata', () => {
    const program = validProgram();
    const waypoint = program.waypoints[0]!;
    expect(validateActionProgramV1({
      ...program,
      waypoints: [{ ...waypoint, source: 'measuredCapture', capturedAtUtc: null }]
    }, dummyProfile).valid).toBe(false);
    expect(validateActionProgramV1({
      ...program,
      waypoints: [{ ...waypoint, source: 'manual', capturedAtUtc: timestampUtc }]
    }, dummyProfile).valid).toBe(false);
  });

  it('enforces the import size limit before parsing JSON', () => {
    const result = parseActionProgramJson(`{"schemaVersion":"1.0","padding":"${'x'.repeat(1024 * 1024)}"}`, dummyProfile);

    expect(result).toEqual({ valid: false, program: null, errors: ['动作程序超过 1 MiB 文件上限'] });
  });
});

function validProgram(): ActionProgramV1 {
  return createActionProgramV1({
    programId: '6c899952-10e8-4a4f-97a1-13de0cd00a01',
    name: 'Pick cycle',
    timestampUtc,
    waypoints: [createActionWaypointV1({
      waypointId: '9ef34ad8-50e0-4ad0-b754-272e83df0001',
      sequence: 1,
      positionsDeg: [0, 0, 0, 0, 0, 0],
      source: 'manual',
      timestampUtc
    })]
  });
}
