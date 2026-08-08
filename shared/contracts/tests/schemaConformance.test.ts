import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import dummyProfile from '../../robot-profiles/BuiltIn/dummy-6dof/manifest.json';
import gatewaySchema from '../gateway-contracts-v1.schema.json';
import profileSchema from '../robot-profile-v1.schema.json';
import type { CommandResult, RobotProfileManifestV1, RobotSessionSnapshot } from '../src/types';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(gatewaySchema);

function gatewayValidator(definition: string) {
  const validator = ajv.getSchema(`${gatewaySchema.$id}#/$defs/${definition}`);
  if (!validator) throw new Error(`Missing gateway schema definition: ${definition}`);
  return validator;
}

describe('JSON Schema and TypeScript contract conformance', () => {
  it('accepts the built-in Dummy manifest in both the TS shape and JSON Schema', () => {
    const typedProfile: RobotProfileManifestV1 = {
      ...dummyProfile,
      schemaVersion: '1.0',
      transportDefaults: { ...dummyProfile.transportDefaults, lineEnding: 'LF' },
      model: { ...dummyProfile.model, upAxis: 'Z', lengthUnit: 'm' },
      capabilities: { ...dummyProfile.capabilities, controlModes: [1, 2, 3] }
    };
    const validate = ajv.compile(profileSchema);
    expect(validate(typedProfile), JSON.stringify(validate.errors)).toBe(true);
    expect(typedProfile.capabilities.controlModes).toEqual([1, 2, 3]);
  });

  it('rejects excluded control modes in profile and session contracts', () => {
    const validateProfile = ajv.compile(profileSchema);
    expect(validateProfile({
      ...dummyProfile,
      capabilities: { ...dummyProfile.capabilities, controlModes: [1, 2, 3, 5] }
    })).toBe(false);

    const validateSession = gatewayValidator('RobotSessionSnapshot');
    const session = {
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
      controlMode: 5, timestampUtc: '2026-08-08T00:00:00.000Z', source: 'measured', validity: 'valid'
    };
    expect(validateSession(session)).toBe(false);
  });

  it('keeps unconfirmed distinct and requires an auditable timestamp', () => {
    const result = {
      commandId: 'cmd-1', status: 'unconfirmed', message: 'No physical confirmation',
      timestampUtc: '2026-08-08T00:00:00.000Z', deviceReply: 'ok'
    } satisfies CommandResult;
    const validate = gatewayValidator('CommandResult');
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
    const { timestampUtc: _timestampUtc, ...withoutTimestamp } = result;
    expect(validate(withoutTimestamp)).toBe(false);
  });

  it('rejects schema extensions that would silently cross the wire boundary', () => {
    const session = {
      sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'offline', motorState: 'unknown',
      controlMode: null, timestampUtc: '2026-08-08T00:00:00.000Z', source: 'unavailable', validity: 'unavailable'
    } satisfies RobotSessionSnapshot;
    const validate = gatewayValidator('RobotSessionSnapshot');
    expect(validate(session)).toBe(true);
    expect(validate({ ...session, hiddenConnectedFlag: true })).toBe(false);
  });

  it.each([
    ['JointStateFrame', {
      sequence: 1, profileId: 'dummy-6dof', timestampUtc: '2026-08-08T00:00:00.000Z',
      positionsDeg: [0, 1, 2, 3, 4, 5], source: 'measured', validity: 'valid'
    }],
    ['SerialPortDescriptor', {
      portName: 'COM4', hardwareId: null, displayName: 'Dummy USB Serial'
    }],
    ['ReadOnlyConnectRequest', {
      portName: 'COM4', profileId: 'dummy-6dof'
    }],
    ['ReadOnlyGatewayCapabilities', {
      contractVersion: '1.0', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: false,
      allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE']
    }],
    ['JointGroupCommand', {
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof',
      positionsDeg: [0, 1, 2, 3, 4, 5], speedDegS: 10
    }],
    ['ProtocolFrame', {
      id: 'frame-1', timestampUtc: '2026-08-08T00:00:00.000Z', direction: 'rx',
      raw: 'ok 0 1 2 3 4 5', parsedKind: 'jointPositions', source: 'measured'
    }],
    ['SignalDescriptor', {
      signalId: 'joint.j1.position', displayName: 'J1', unit: 'deg', source: 'measured', color: '#FFFFFF'
    }],
    ['SignalSample', {
      timestampUtc: '2026-08-08T00:00:00.000Z', value: 1.25, validity: 'valid'
    }],
    ['DesktopBridgeCapabilities', {
      available: false, minimize: false, toggleMaximize: false, close: false
    }],
    ['OperationEvent', {
      id: 'event-1', timestampUtc: '2026-08-08T00:00:00.000Z', severity: 'warning',
      title: 'SERIAL OFFLINE', detail: 'No transport is connected.', source: 'unavailable'
    }]
  ])('validates the %s wire contract', (definition, value) => {
    const validate = gatewayValidator(definition);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });
});
