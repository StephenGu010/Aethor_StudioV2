import type { CommandAuditRecord, CommandResult, RobotGatewayCapabilitiesV1, RobotSessionSnapshot } from '@aethor/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfilePackageValidation } from '../../domain/profilePackage';
import * as profilePackage from '../../domain/profilePackage';
import type { DesktopBridgeV1 } from '../../integrations/desktopBridge';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { aethorRoboProfile } from '../../profile/aethorRoboProfile';
import { dummyProfile } from '../../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { DeviceModelPage } from './DeviceModelPage';

describe('DeviceModelPage supervised safety states', () => {
  beforeEach(() => {
    useActiveRobotProfileStore.setState({ activeProfileId: dummyProfile.profileId });
    useGatewayRuntimeStore.getState().resetRuntime();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the Aethor_robo profile boundary without touching the Dummy gateway', () => {
    const gateway = fakeGateway({
      session: session('offline', 'unavailable'),
      capabilities: readOnlyCapabilities
    });
    gateway.capabilities.readOnlyConnection = false;
    gateway.capabilities.serialEnumeration = false;
    const listSerialPorts = vi.spyOn(gateway, 'listSerialPorts');
    useActiveRobotProfileStore.setState({ activeProfileId: aethorRoboProfile.profileId });

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);

    expect(screen.getByText('SPACE ROBOT PROFILE')).toBeInTheDocument();
    expect(screen.getByText('AETHOR-ROBO-PENDING')).toBeInTheDocument();
    expect(screen.getByText('14 / 14 MAPPED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到 Dummy' })).toBeEnabled();
    expect(listSerialPorts).not.toHaveBeenCalled();
  });

  it('keeps support bundle export unavailable in a browser for either profile', () => {
    const bridge = fakeDesktopBridge(false);
    render(<Tooltip.Provider><DeviceModelPage bridge={bridge} /></Tooltip.Provider>);

    expect(screen.getByRole('button', { name: '导出桌面诊断包' })).toBeDisabled();
    expect(screen.getByText(/需要 Windows 桌面版/)).toBeInTheDocument();
    expect(bridge.exportDiagnostics).not.toHaveBeenCalled();
  });

  it('exports one desktop support bundle and reports the acknowledged result', async () => {
    const bridge = fakeDesktopBridge(true);
    render(<Tooltip.Provider><DeviceModelPage bridge={bridge} /></Tooltip.Provider>);

    fireEvent.click(screen.getByRole('button', { name: '导出桌面诊断包' }));

    await waitFor(() => expect(bridge.exportDiagnostics).toHaveBeenCalledOnce());
    expect(await screen.findByText('诊断包已生成到所选位置。')).toBeInTheDocument();
  });

  it('does not report a support bundle when the native host cancels or fails', async () => {
    const bridge = fakeDesktopBridge(true);
    vi.mocked(bridge.exportDiagnostics).mockResolvedValue(false);
    render(<Tooltip.Provider><DeviceModelPage bridge={bridge} /></Tooltip.Provider>);

    fireEvent.click(screen.getByRole('button', { name: '导出桌面诊断包' }));

    expect(await screen.findByText(/已取消或未能生成/)).toBeInTheDocument();
    expect(screen.queryByText('诊断包已生成到所选位置。')).not.toBeInTheDocument();
  });

  it('keeps serial selection and every hardware action disabled without gateway config', () => {
    const gateway = fakeGateway({
      session: session('offline', 'unavailable'),
      capabilities: readOnlyCapabilities
    });
    gateway.capabilities.readOnlyConnection = false;
    gateway.capabilities.serialEnumeration = false;
    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);

    expect(screen.getByText('BACKEND ABSENT')).toBeInTheDocument();
    expect(screen.getByLabelText('串口')).toBeDisabled();
    expect(screen.getByRole('button', { name: /连接设备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /停止并去使能/ })).toBeDisabled();
    expect(screen.getByText(/静态数据不会提升为在线状态/)).toBeInTheDocument();
    expect(screen.getByText('Aethor_robo')).toBeInTheDocument();
    expect(screen.getByText('MODEL READY')).toBeInTheDocument();
    expect(screen.getByText('PROTOCOL PENDING')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开双臂控制台' })).toHaveAttribute('href', '/console');
  });

  it('cancels superseded package validation and never renders the stale result', async () => {
    const first = deferred<ProfilePackageValidation>();
    const second = deferred<ProfilePackageValidation>();
    const validate = vi.spyOn(profilePackage, 'validateProfilePackage').mockImplementation((file) => (
      file.name === 'first.aethor-robot' ? first.promise : second.promise
    ));
    render(<Tooltip.Provider><DeviceModelPage /></Tooltip.Provider>);
    const input = document.querySelector<HTMLInputElement>('.packageDropzone input');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [new File(['first'], 'first.aethor-robot')] } });
    fireEvent.change(input!, { target: { files: [new File(['second'], 'second.aethor-robot')] } });

    expect(validate).toHaveBeenCalledTimes(2);
    expect(validate.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(validate.mock.calls[1]?.[1]?.aborted).toBe(false);
    await act(async () => second.resolve({
      valid: false,
      profile: null,
      errors: ['SECOND PACKAGE REJECTED'],
      fileCount: 1,
      unpackedBytes: 1
    }));
    expect(await screen.findByText('SECOND PACKAGE REJECTED')).toBeInTheDocument();

    await act(async () => first.resolve({
      valid: true,
      profile: null,
      errors: [],
      fileCount: 1,
      unpackedBytes: 1
    }));
    expect(screen.getByText('SECOND PACKAGE REJECTED')).toBeInTheDocument();
    expect(screen.queryByText('PACKAGE STRUCTURE VALID')).not.toBeInTheDocument();
  });

  it('enumerates without auto-connecting and preserves read-only command lockout', async () => {
    const offline = session('offline', 'unavailable');
    const connected = session('connected', 'stale');
    const connect = vi.fn(async () => connected);
    const gateway = fakeGateway({
      session: offline,
      capabilities: readOnlyCapabilities,
      connect
    });
    const getCapabilities = vi.spyOn(gateway, 'getCapabilities');
    const getSession = vi.spyOn(gateway, 'getSession');
    const getJointState = vi.spyOn(gateway, 'getJointState');
    const getCommandHistory = vi.spyOn(gateway, 'getCommandHistory');

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);
    await screen.findByRole('option', { name: 'Dummy USB · COM4' });
    expect(connect).not.toHaveBeenCalled();
    expect(getCapabilities).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(getJointState).not.toHaveBeenCalled();
    expect(getCommandHistory).not.toHaveBeenCalled();
    const connectButton = screen.getByRole('button', { name: /连接设备/ });
    expect(connectButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('串口'), { target: { value: 'COM4' } });
    expect(connectButton).toBeEnabled();
    fireEvent.click(connectButton);
    await waitFor(() => expect(connect).toHaveBeenCalledWith(
      { portName: 'COM4', profileId: 'dummy-6dof' },
      expect.stringMatching(/^[0-9a-f-]{36}$/i)
    ));
    expect(useGatewayRuntimeStore.getState().activePortName).toBe('COM4');
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();
    expect(screen.getByText(/READ-ONLY GATEWAY/)).toBeInTheDocument();
  });

  it('requires confirmation and renders the evidence-backed command terminal state', async () => {
    const connected = {
      ...session('connected', 'valid'),
      motorState: 'disabled' as const,
      controlMode: 2 as const
    };
    const enable = vi.fn(async (command): Promise<CommandResult> => ({
      commandId: command.commandId,
      sessionId: command.sessionId,
      commandKind: 'enable',
      status: 'completed',
      code: 'ok',
      evidence: 'feedbackConfirmed',
      message: '使能已由设备状态回读确认',
      timestampUtc: connected.timestampUtc
    }));
    const gateway = fakeGateway({ session: connected, capabilities: supervisedCapabilities, enable });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);
    await screen.findByRole('button', { name: /使能设备/ });
    await waitFor(() => expect(useGatewayRuntimeStore.getState()).toMatchObject({
      session: { connectionState: 'connected', validity: 'valid' },
      capabilities: { hardwareCommands: true, commandPolicy: 'supervised' }
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: /使能设备/ })).toBeEnabled());
    const enableButton = screen.getByRole('button', { name: /使能设备/ });

    fireEvent.click(enableButton);
    expect(confirm).toHaveBeenCalledOnce();
    expect(enable).not.toHaveBeenCalled();
    fireEvent.click(enableButton);

    await waitFor(() => expect(enable).toHaveBeenCalledOnce());
    expect(await screen.findByText('ENABLE · COMPLETED')).toBeInTheDocument();
    expect(screen.getByText(/使能已由设备状态回读确认/)).toBeInTheDocument();
  });

  it('keeps the stop operation busy when the preempted command settles first', async () => {
    const connected = { ...session('connected', 'valid'), motorState: 'enabled' as const, controlMode: 2 as const };
    const enableResult = deferred<CommandResult>();
    const stopResult = deferred<CommandResult>();
    const gateway = fakeGateway({
      session: connected,
      capabilities: supervisedCapabilities,
      enable: async () => enableResult.promise,
      stopAndDisable: async () => stopResult.promise
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);
    await waitFor(() => expect(screen.getByRole('button', { name: /使能设备/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /使能设备/ }));
    fireEvent.click(screen.getByRole('button', { name: /停止并去使能/ }));

    enableResult.resolve(commandResult('enable', 'cancelled'));
    await waitFor(() => expect(screen.getByRole('button', { name: /正在等待终态/ })).toBeDisabled());

    stopResult.resolve(commandResult('stopAndDisable', 'completed'));
    expect(await screen.findByText('STOPANDDISABLE · COMPLETED')).toBeInTheDocument();
  });

  it('locks normal controls after an uncertain command but leaves stop available', async () => {
    const connected = { ...session('connected', 'valid'), motorState: 'disabled' as const, controlMode: 2 as const };
    const gateway = fakeGateway({ session: connected, capabilities: supervisedCapabilities });
    useGatewayRuntimeStore.getState().setLastCommandResult(commandResult('enable', 'unconfirmed'));

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);

    await waitFor(() => expect(screen.getByRole('button', { name: /停止并去使能/ })).toBeEnabled());
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /使能设备/ })).toHaveAttribute('title', expect.stringContaining('安全联锁'));
  });

  it('fails closed for normal commands when authoritative audit recovery is unavailable', async () => {
    const connected = { ...session('connected', 'valid'), motorState: 'disabled' as const, controlMode: 2 as const };
    const gateway = fakeGateway({
      session: connected,
      capabilities: supervisedCapabilities,
      commandAuditError: 'audit endpoint unavailable'
    });

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);

    await waitFor(() => expect(screen.getByRole('button', { name: /停止并去使能/ })).toBeEnabled());
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /使能设备/ })).toHaveAttribute(
      'title',
      expect.stringContaining('命令审计恢复失败')
    );
    expect(screen.getByRole('alert')).toHaveTextContent('audit endpoint unavailable');
  });

  it('latches an unconfirmed result when a structured command response is lost', async () => {
    const connected = { ...session('connected', 'valid'), motorState: 'disabled' as const, controlMode: 2 as const };
    const enable = vi.fn(async () => { throw new Error('response connection closed'); });
    const gateway = fakeGateway({ session: connected, capabilities: supervisedCapabilities, enable });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);
    await waitFor(() => expect(screen.getByRole('button', { name: /使能设备/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /使能设备/ }));

    await waitFor(() => expect(enable).toHaveBeenCalledOnce());
    expect(useGatewayRuntimeStore.getState()).toMatchObject({
      commandAuditStatus: 'error',
      lastCommandResult: {
        commandKind: 'enable',
        status: 'unconfirmed',
        code: 'transportError',
        evidence: 'none'
      }
    });
    expect(screen.getByRole('button', { name: /使能设备/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /停止并去使能/ })).toBeEnabled();
  });

  it('renders authoritative request fingerprints and actual transport writes from command audit', async () => {
    const connected = { ...session('connected', 'valid'), motorState: 'disabled' as const, controlMode: 2 as const };
    const record = auditRecord('mode-audit', connected.sessionId);
    const gateway = fakeGateway({ session: connected, capabilities: supervisedCapabilities, commandHistory: [record] });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aethor-command-audit');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<Tooltip.Provider><DeviceModelPage gateway={gateway} /></Tooltip.Provider>);

    expect(await screen.findByText('SETMODE')).toBeInTheDocument();
    expect(screen.getByText('#CMDMODE 2 → #GETMODE')).toBeInTheDocument();
    expect(screen.getByText(record.request.requestFingerprintSha256)).toBeInTheDocument();
    const exportButton = screen.getByRole('button', { name: '导出命令审计 JSON' });
    expect(exportButton).toBeEnabled();

    fireEvent.click(exportButton);

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:aethor-command-audit');
  });
});

const readOnlyCapabilities: RobotGatewayCapabilitiesV1 = {
  contractVersion: '1.2',
  protocolAdapterId: 'dummy-ascii-v1',
  serialEnumeration: true,
  readOnlyConnection: true,
  liveTelemetry: true,
  hardwareCommands: false,
  directCommand: false,
  commandPolicy: 'disabled',
  allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
  supportedCommands: [],
  jointGroupSpeedLimitDegS: null,
  jointGroupCompletion: null,
  engineeringJointSpeedMaxDegS: null
};

const supervisedCapabilities: RobotGatewayCapabilitiesV1 = {
  ...readOnlyCapabilities,
  hardwareCommands: true,
  commandPolicy: 'supervised',
  supportedCommands: ['enable', 'stopAndDisable', 'home', 'reset', 'setMode']
};

function fakeGateway({
  session: snapshot,
  capabilities,
  connect = vi.fn(async () => snapshot),
  enable = vi.fn(async (command) => unsupported(command.commandId, command.sessionId, 'enable')),
  stopAndDisable = vi.fn(async (command) => unsupported(command.commandId, command.sessionId, 'stopAndDisable')),
  commandHistory = [],
  commandAuditError = null
}: {
  session: RobotSessionSnapshot;
  capabilities: RobotGatewayCapabilitiesV1;
  connect?: RobotGatewayV1['connect'];
  enable?: RobotGatewayV1['enable'];
  stopAndDisable?: RobotGatewayV1['stopAndDisable'];
  commandHistory?: CommandAuditRecord[];
  commandAuditError?: string | null;
}): RobotGatewayV1 {
  useGatewayRuntimeStore.getState().setSession(snapshot);
  useGatewayRuntimeStore.getState().setCapabilities(capabilities);
  useGatewayRuntimeStore.getState().setJointState({
    sequence: 1,
    profileId: 'dummy-6dof',
    timestampUtc: snapshot.timestampUtc,
    positionsDeg: [0, 0, 0, 0, 0, 0],
    source: snapshot.source,
    validity: snapshot.validity
  });
  if (commandAuditError) useGatewayRuntimeStore.getState().failCommandAuditRefresh(commandAuditError);
  else useGatewayRuntimeStore.getState().replaceCommandHistory(commandHistory);

  return {
    capabilities: {
      source: 'gateway', serialEnumeration: true, readOnlyConnection: true,
      hardwareCommands: false, rawCommand: false, liveTelemetry: true,
      commandPolicy: 'disabled', supportedCommands: [], jointGroupSpeedLimitDegS: null,
      jointGroupCompletion: null, engineeringJointSpeedMaxDegS: null
    },
    getCapabilities: async () => capabilities,
    listSerialPorts: async () => [{ portName: 'COM4', hardwareId: null, displayName: 'Dummy USB · COM4' }],
    connect,
    disconnect: async () => session('offline', 'unavailable'),
    openTelemetry: async () => async () => {},
    getSession: async () => snapshot,
    getJointState: async () => ({
      sequence: 1, profileId: 'dummy-6dof', timestampUtc: snapshot.timestampUtc,
      positionsDeg: [0, 0, 0, 0, 0, 0], source: snapshot.source, validity: snapshot.validity
    }),
    getProtocolFrames: async () => [],
    getCommandHistory: async () => commandHistory,
    enable,
    stopAndDisable,
    home: async (command) => unsupported(command.commandId, command.sessionId, 'home'),
    reset: async (command) => unsupported(command.commandId, command.sessionId, 'reset'),
    setMode: async (command) => unsupported(command.commandId, command.sessionId, 'setMode'),
    sendJointGroup: async (command) => unsupported(command.commandId, command.sessionId, 'jointGroup'),
    sendDirectCommand: async (command) => ({
      requestId: command.requestId,
      sessionId: command.sessionId,
      status: 'rejected',
      evidence: 'none',
      normalizedLine: command.line,
      message: 'not used',
      timestampUtc: '2026-08-09T00:00:00.000Z'
    })
  };
}

function auditRecord(commandId: string, sessionId: string): CommandAuditRecord {
  return {
    commandId,
    sessionId,
    profileId: 'dummy-6dof',
    commandKind: 'setMode',
    acceptedAtUtc: '2026-08-09T10:00:00.000Z',
    request: {
      commandKind: 'setMode',
      requestFingerprintSha256: 'A'.repeat(64),
      mode: 2,
      positionsDeg: null,
      positionsCount: null,
      speedDegS: null,
      payloadTruncated: false
    },
    transmittedPayloads: ['#CMDMODE 2', '#GETMODE'],
    transmissionLogTruncated: false,
    result: {
      commandId,
      sessionId,
      commandKind: 'setMode',
      status: 'completed',
      code: 'ok',
      evidence: 'feedbackConfirmed',
      message: '模式 2 已由设备回读确认',
      timestampUtc: '2026-08-09T10:00:01.000Z'
    }
  };
}

function commandResult(commandKind: CommandResult['commandKind'], status: CommandResult['status']): CommandResult {
  return {
    commandId: `${commandKind}-1`, sessionId: 'session-1', commandKind, status,
    code: status === 'completed' ? 'ok' : status === 'unconfirmed' ? 'deviceUnconfirmed' : 'cancelled',
    evidence: status === 'completed' ? 'feedbackConfirmed' : status === 'unconfirmed' ? 'deviceAck' : 'gatewayAccepted',
    message: status, timestampUtc: '2026-08-09T10:00:00.000Z'
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function fakeDesktopBridge(available: boolean): DesktopBridgeV1 {
  return {
    capabilities: {
      available,
      minimize: available,
      toggleMaximize: available,
      close: available,
      exportDiagnostics: available
    },
    minimize: vi.fn(async () => available),
    toggleMaximize: vi.fn(async () => available),
    close: vi.fn(async () => available),
    beginDrag: vi.fn(async () => available),
    exportDiagnostics: vi.fn(async () => available)
  };
}

function unsupported(commandId: string, sessionId: string, commandKind: CommandResult['commandKind']): CommandResult {
  return {
    commandId, sessionId, commandKind, status: 'unsupported', code: 'commandsDisabled', evidence: 'none',
    message: 'disabled', timestampUtc: '2026-08-09T10:00:00.000Z'
  };
}

function session(connectionState: RobotSessionSnapshot['connectionState'], validity: RobotSessionSnapshot['validity']): RobotSessionSnapshot {
  return {
    sessionId: connectionState === 'offline' ? 'offline' : 'session-1',
    profileId: 'dummy-6dof', connectionState, motorState: 'unknown', controlMode: null,
    timestampUtc: '2026-08-09T10:00:00.000Z', source: connectionState === 'offline' ? 'unavailable' : 'measured', validity
  };
}
