import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import dummyProfile from '../../robot-profiles/BuiltIn/dummy-6dof/manifest.json';
import aethorRoboProfile from '../../robot-profiles/BuiltIn/aethor-robo-dual-7dof/manifest.json';
import actionProgramExample from '../examples/dummy-action-program-v1.example.json';
import actionProgramSchema from '../action-program-v1.schema.json';
import gatewaySchema from '../gateway-contracts-v1.schema.json';
import profileSchema from '../robot-profile-v1.schema.json';
import type { ActionProgramV1 } from '../src/actionProgram';
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
  it('accepts the versioned Dummy action example in TypeScript and JSON Schema', () => {
    const typedProgram: ActionProgramV1 = {
      ...actionProgramExample,
      schemaVersion: '1.0',
      profileId: 'dummy-6dof',
      jointCoordinateSystem: 'dummy-device-joints-v1',
      source: 'showcaseExample',
      waypoints: actionProgramExample.waypoints.map((waypoint) => ({
        ...waypoint,
        mode: 2,
        source: 'showcaseExample',
        postArrivalWait: { kind: 'none' },
        capturedAtUtc: null
      }))
    };
    const validate = ajv.compile(actionProgramSchema);

    expect(validate(typedProgram), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects unsafe or silently incompatible action documents', () => {
    const validate = ajv.compile(actionProgramSchema);
    const waypoint = actionProgramExample.waypoints[0]!;

    expect(validate({ ...actionProgramExample, schemaVersion: '2.0' })).toBe(false);
    expect(validate({ ...actionProgramExample, hiddenExecutionFlag: true })).toBe(false);
    expect(validate({ ...actionProgramExample, waypoints: [{ ...waypoint, mode: 5 }] })).toBe(false);
    expect(validate({ ...actionProgramExample, waypoints: [{ ...waypoint, positionsDeg: [0, 0, 0, 0, 0] }] })).toBe(false);
    expect(validate({ ...actionProgramExample, waypoints: [{ ...waypoint, positionsDeg: [180, 0, 0, 0, 0, 0] }] })).toBe(false);
    expect(validate({
      ...actionProgramExample,
      waypoints: [{ ...waypoint, source: 'measuredCapture', capturedAtUtc: null }]
    })).toBe(false);
  });

  it('accepts the built-in Dummy manifest in both the TS shape and JSON Schema', () => {
    const typedProfile: RobotProfileManifestV1 = {
      ...dummyProfile,
      schemaVersion: '1.0',
      transportDefaults: { ...dummyProfile.transportDefaults, lineEnding: 'LF' },
      model: { ...dummyProfile.model, upAxis: 'Z', lengthUnit: 'm' },
      joints: dummyProfile.joints.map((joint) => ({
        ...joint,
        modelTransform: { ...joint.modelTransform, sign: 1 as const }
      })),
      capabilities: { ...dummyProfile.capabilities, controlModes: [1, 2, 3] }
    };
    const validate = ajv.compile(profileSchema);
    expect(validate(typedProfile), JSON.stringify(validate.errors)).toBe(true);
    expect(typedProfile.capabilities.controlModes).toEqual([1, 2, 3]);
    expect(typedProfile.joints[2]?.modelTransform).toEqual({ sign: 1, offsetDeg: -90 });
    expect(validate({
      ...typedProfile,
      joints: typedProfile.joints.map((joint, index) => index === 2
        ? { ...joint, modelTransform: { sign: 0, offsetDeg: -90 } }
        : joint)
    })).toBe(false);
  });

  it('accepts the built-in Aethor_robo dual-arm preview manifest without hardware claims', () => {
    const typedProfile: RobotProfileManifestV1 = {
      ...aethorRoboProfile,
      schemaVersion: '1.0',
      model: { ...aethorRoboProfile.model, upAxis: 'Z', lengthUnit: 'm' },
      capabilities: { ...aethorRoboProfile.capabilities, controlModes: [] }
    };
    const validate = ajv.compile(profileSchema);
    expect(validate(typedProfile), JSON.stringify(validate.errors)).toBe(true);
    expect(typedProfile.jointGroups?.map((group) => group.jointIds.length)).toEqual([7, 7]);
    expect(typedProfile.capabilities.jointGroupCommand).toBe(false);
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
      commandId: 'cmd-1', sessionId: 'session-1', commandKind: 'jointGroup', status: 'unconfirmed',
      code: 'deviceUnconfirmed', evidence: 'deviceQueued', message: 'No physical confirmation',
      timestampUtc: '2026-08-08T00:00:00.000Z', deviceReply: 'ok'
    } satisfies CommandResult;
    const validate = gatewayValidator('CommandResult');
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
    const { timestampUtc: _timestampUtc, ...withoutTimestamp } = result;
    expect(validate(withoutTimestamp)).toBe(false);
  });

  it('accepts an explicit null device reply from the JSON gateway boundary', () => {
    const result = {
      commandId: 'cmd-null-reply', sessionId: 'session-1', commandKind: 'enable', status: 'rejected',
      code: 'notConnected', evidence: 'none', message: 'Robot is offline',
      timestampUtc: '2026-08-08T00:00:00.000Z', deviceReply: null
    } satisfies CommandResult;
    const validate = gatewayValidator('CommandResult');
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
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

  it('rejects contradictory capability claims and malformed six-axis targets', () => {
    const validateCapabilities = gatewayValidator('RobotGatewayCapabilitiesV1');
    expect(validateCapabilities({
      contractVersion: '1.3', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: false,
      commandPolicy: 'disabled', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['enable'], jointGroupSpeedLimitDegS: null, jointGroupCompletion: null,
      engineeringJointSpeedMaxDegS: null
    })).toBe(false);
    expect(validateCapabilities({
      contractVersion: '1.3', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: true,
      commandPolicy: 'engineering', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['enable', 'stopAndDisable', 'setMode'], jointGroupSpeedLimitDegS: null,
      jointGroupCompletion: null, engineeringJointSpeedMaxDegS: 100
    })).toBe(true);
    expect(validateCapabilities({
      contractVersion: '1.3', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: false,
      commandPolicy: 'supervised', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['jointGroup'], jointGroupSpeedLimitDegS: null, jointGroupCompletion: null,
      engineeringJointSpeedMaxDegS: null
    })).toBe(false);
    expect(validateCapabilities({
      contractVersion: '1.3', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: false,
      commandPolicy: 'supervised', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['jointGroup'], jointGroupSpeedLimitDegS: 10, jointGroupCompletion: null,
      engineeringJointSpeedMaxDegS: null
    })).toBe(false);
    expect(validateCapabilities({
      contractVersion: '1.3', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: false,
      commandPolicy: 'supervised', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: ['jointGroup'], jointGroupSpeedLimitDegS: 10,
      jointGroupCompletion: { positionToleranceDeg: 0.25, settledDurationMs: 1000, timeoutMs: 499 },
      engineeringJointSpeedMaxDegS: null
    })).toBe(false);

    const validateJointGroup = gatewayValidator('JointGroupCommand');
    expect(validateJointGroup({
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof',
      positionsDeg: [0, 0, 0, 0, 0], speedDegS: 10
    })).toBe(false);
  });

  it('keeps command request evidence bounded and command identities consistent', () => {
    const validateAudit = gatewayValidator('CommandAuditRecord');
    const audit = {
      commandId: 'cmd-mode-2', sessionId: 'session-1', profileId: 'dummy-6dof', commandKind: 'setMode',
      acceptedAtUtc: '2026-08-09T00:00:00.000Z',
      request: {
        commandKind: 'setMode', requestFingerprintSha256: 'A'.repeat(64), mode: 2,
        positionsDeg: null, positionsCount: null, speedDegS: null, payloadTruncated: false
      },
      transmittedPayloads: ['#CMDMODE 2', '#GETMODE'],
      transmissionLogTruncated: false,
      result: {
        commandId: 'cmd-mode-2', sessionId: 'session-1', commandKind: 'setMode', status: 'completed',
        code: 'ok', evidence: 'feedbackConfirmed', message: 'mode confirmed', timestampUtc: '2026-08-09T00:00:01.000Z'
      }
    };
    expect(validateAudit(audit), JSON.stringify(validateAudit.errors)).toBe(true);
    expect(validateAudit({ ...audit, commandKind: 'enable' })).toBe(false);
    expect(validateAudit({
      ...audit,
      commandKind: 'jointGroup',
      request: {
        commandKind: 'jointGroup', requestFingerprintSha256: 'B'.repeat(64), mode: null,
        positionsDeg: [1, 2, 3, 4, 5, 6], positionsCount: 7, speedDegS: 10, payloadTruncated: false
      },
      result: { ...audit.result, commandKind: 'jointGroup' }
    })).toBe(false);
  });

  it('keeps write-only direct results distinct from device acknowledgements', () => {
    const validate = gatewayValidator('DirectCommandResult');
    const sent = {
      requestId: 'move-1', sessionId: 'session-1', status: 'sent', evidence: 'transportWritten',
      normalizedLine: '>1,2,3,4,5,6,10', message: 'written only', timestampUtc: '2026-08-12T00:00:00.000Z'
    };

    expect(validate(sent), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...sent, evidence: 'deviceAck' })).toBe(false);
    expect(validate({ ...sent, deviceReply: 'ok' })).toBe(false);
    expect(validate({ ...sent, status: 'replied' })).toBe(false);
  });

  it.each([
    ['JointStateFrame', {
      sequence: 1, profileId: 'dummy-6dof', timestampUtc: '2026-08-08T00:00:00.000Z',
      positionsDeg: [0, 1, 2, 3, 4, 5], source: 'measured', validity: 'valid'
    }],
    ['SerialPortDescriptor', {
      portName: 'COM4', hardwareId: null, displayName: 'Dummy USB Serial'
    }],
    ['RobotConnectRequest', {
      portName: 'COM4', profileId: 'dummy-6dof'
    }],
    ['RobotGatewayCapabilitiesV1', {
      contractVersion: '1.3', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
      readOnlyConnection: true, liveTelemetry: true, hardwareCommands: false, directCommand: false,
      commandPolicy: 'disabled', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
      supportedCommands: [], jointGroupSpeedLimitDegS: null, jointGroupCompletion: null,
      engineeringJointSpeedMaxDegS: null
    }],
    ['SimpleRobotCommand', {
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof'
    }],
    ['SetModeCommand', {
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof', mode: 2
    }],
    ['JointGroupCommand', {
      commandId: 'cmd-1', sessionId: 'session-1', profileId: 'dummy-6dof',
      positionsDeg: [0, 1, 2, 3, 4, 5], speedDegS: 10
    }],
    ['DirectCommandRequest', {
      requestId: 'direct-1', sessionId: 'session-1', profileId: 'dummy-6dof', line: '#GETJPOS'
    }],
    ['DirectCommandResult', {
      requestId: 'direct-1', sessionId: 'session-1', status: 'sent', evidence: 'transportWritten',
      normalizedLine: '>0,1,2,3,4,5,10', message: 'written, manually confirmed', timestampUtc: '2026-08-08T00:00:00.000Z'
    }],
    ['RobotCommandRequestSnapshot', {
      commandKind: 'jointGroup', requestFingerprintSha256: 'C'.repeat(64), mode: null,
      positionsDeg: [0, 1, 2, 3, 4, 5], positionsCount: 6, speedDegS: 10, payloadTruncated: false
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
      available: false, minimize: false, toggleMaximize: false, close: false, exportDiagnostics: false
    }],
    ['DesktopBootstrapV1', {
      contractVersion: '1.0', gateway: { baseUrl: 'http://127.0.0.1:5127', sessionToken: 'A'.repeat(43) },
      capabilities: { available: true, minimize: true, toggleMaximize: true, close: true, exportDiagnostics: true }
    }],
    ['DesktopBridgeRequestV1', {
      contractVersion: '1.0', requestId: 'request-1', action: 'beginDrag'
    }],
    ['DesktopBridgeResponseV1', {
      contractVersion: '1.0', requestId: 'request-1', ok: false, errorCode: 'unsupported'
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
