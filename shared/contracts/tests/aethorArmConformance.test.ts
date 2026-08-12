import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import schema from '../aethor-arm-gateway-v1.schema.json';
import type { AethorArmMotorFrameV1 } from '../src/aethorArmV1';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/AethorArmMotorFrameV1`)!;

describe('Aethor arm commissioning contract', () => {
  it('accepts an unordered partial motor snapshot', () => {
    const frame: AethorArmMotorFrameV1 = {
      contractVersion: '1.0',
      profileId: 'aethor-robo-dual-7dof',
      jointGroupId: 'left-arm',
      controllerId: 'aethor-controller-01',
      armId: 'arm-01',
      bootId: 'boot-17',
      frameSeq: 42,
      receivedAtUtc: '2026-08-12T12:00:00.000Z',
      snapshotComplete: true,
      motors: [
        { motorId: 7, positionDeg: 70, feedbackAgeMs: 2, valid: true },
        { motorId: 2, positionDeg: 20, feedbackAgeMs: 3, valid: true }
      ]
    };

    expect(validate(frame), JSON.stringify(validate.errors)).toBe(true);
  });

  it('preserves duplicate and out-of-range observations for domain diagnostics', () => {
    const frame = validFrame();
    frame.motors = [
      { motorId: 3, positionDeg: 31, feedbackAgeMs: 1, valid: true },
      { motorId: 3, positionDeg: 32, feedbackAgeMs: 1, valid: true },
      { motorId: 8, positionDeg: 80, feedbackAgeMs: 1, valid: true }
    ];

    expect(validate(frame), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects incompatible identity, malformed time and oversized snapshots', () => {
    expect(validate({ ...validFrame(), contractVersion: '2.0' })).toBe(false);
    expect(validate({ ...validFrame(), receivedAtUtc: 'local-time' })).toBe(false);
    expect(validate({
      ...validFrame(),
      motors: Array.from({ length: 33 }, (_, motorId) => ({
        motorId,
        positionDeg: 0,
        feedbackAgeMs: 0,
        valid: false
      }))
    })).toBe(false);
  });
});

function validFrame(): AethorArmMotorFrameV1 {
  return {
    contractVersion: '1.0',
    profileId: 'aethor-robo-dual-7dof',
    jointGroupId: 'right-arm',
    controllerId: 'aethor-controller-02',
    armId: 'arm-02',
    bootId: 'boot-3',
    frameSeq: 1,
    receivedAtUtc: '2026-08-12T12:00:00.000Z',
    snapshotComplete: true,
    motors: []
  };
}
