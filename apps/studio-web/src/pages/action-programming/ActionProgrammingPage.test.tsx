import type { ActionProgramV1 } from '@aethor/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionProgramV1 } from '../../domain/actionProgram';
import { useActionProgramStore } from '../../stores/useActionProgramStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import type { RobotGatewayV1 } from '../../integrations/robotGateway';
import { ActionProgrammingPage } from './ActionProgrammingPage';

describe('ActionProgrammingPage offline editor', () => {
  beforeEach(() => {
    localStorage.clear();
    useActionProgramStore.getState().resetActionPrograms();
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
    vi.restoreAllMocks();
  });

  it('creates, edits, previews, and automatically saves a local action document without an execution path', async () => {
    renderPage();

    expect(screen.getByText('NO EXECUTION PATH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行程序/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    expect(screen.getByText('AUTO-SAVING')).toBeInTheDocument();
    expect(screen.getByLabelText('动作默认速度')).toHaveValue(20);
    expect(screen.getByRole('switch', { name: '循环执行' })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('动作程序名称'), { target: { value: 'Inspection cycle' } });
    fireEvent.click(screen.getByRole('switch', { name: '循环执行' }));
    fireEvent.click(screen.getByRole('button', { name: '添加目标草稿' }));
    expect(screen.getByText('点位 01')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('J1 点位角度'), { target: { value: '200' } });
    expect(useActionProgramStore.getState().draft?.waypoints[0]?.positionsDeg[0]).toBe(200);

    fireEvent.click(screen.getByRole('button', { name: '加载到 Dummy 本地目标草稿' }));
    expect(useRobotSessionStore.getState().targetPositionsDeg[0]).toBe(200);
    expect(screen.getByText('TARGET PREVIEW · NO SEND')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByText('AUTO-SAVED').length).toBeGreaterThan(0));
    expect(localStorage.getItem('aethor-studio-v2-action-programs')).toContain('Inspection cycle');
    expect(useActionProgramStore.getState().programs[useActionProgramStore.getState().draft!.programId]).toMatchObject({
      speedDegS: 20,
      loopEnabled: true
    });
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行程序/ })).toBeDisabled();
  });

  it('keeps measured capture disabled for showcase data and preserves every fresh encoder angle exactly', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    expect(screen.getByRole('button', { name: '采集当前点' })).toBeDisabled();

    act(() => {
      useGatewayRuntimeStore.getState().setSession({
        sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
        controlMode: 3, timestampUtc: '2026-08-09T01:00:00.000Z', source: 'measured', validity: 'valid'
      });
      useGatewayRuntimeStore.getState().setJointState({
        sequence: 4, profileId: 'dummy-6dof', timestampUtc: '2026-08-09T01:00:01.000Z',
        positionsDeg: [181, 95, -45, 200, -150, 900], source: 'measured', validity: 'valid'
      });
    });

    expect(screen.getByRole('button', { name: '采集当前点' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '采集当前点' }));
    expect(useActionProgramStore.getState().draft?.waypoints[0]).toMatchObject({
      positionsDeg: [181, 95, -45, 200, -150, 900],
      mode: 3,
      source: 'measuredCapture',
      capturedAtUtc: '2026-08-09T01:00:01.000Z'
    });
    expect(screen.getByText('MEASURED CAPTURE')).toBeInTheDocument();
    expect(screen.queryByText(/LIMIT WARNING|超出 -75…90/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('J2 点位角度')).toHaveAttribute('readonly');
    await waitFor(() => expect(screen.getAllByText('AUTO-SAVED').length).toBeGreaterThan(0));
    expect(useActionProgramStore.getState().programs[useActionProgramStore.getState().draft!.programId]
      ?.waypoints[0]?.positionsDeg).toEqual([181, 95, -45, 200, -150, 900]);

    fireEvent.click(screen.getByRole('button', { name: '加载到 Dummy 本地目标草稿' }));
    expect(useRobotSessionStore.getState().targetPositionsDeg).toEqual([181, 95, -45, 200, -150, 900]);
    expect(screen.getByRole('status')).toHaveTextContent('按原始设备角写入');
  });

  it('requires matching Dummy profile identity before measured capture', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));

    act(() => {
      useGatewayRuntimeStore.getState().setSession({
        sessionId: 'session-1', profileId: 'other-robot', connectionState: 'connected', motorState: 'disabled',
        controlMode: 2, timestampUtc: '2026-08-09T01:00:00.000Z', source: 'measured', validity: 'valid'
      });
      useGatewayRuntimeStore.getState().setJointState({
        sequence: 4, profileId: 'dummy-6dof', timestampUtc: '2026-08-09T01:00:01.000Z',
        positionsDeg: [1, 2, 3, 4, 5, 6], source: 'measured', validity: 'valid'
      });
    });

    expect(screen.getByRole('button', { name: '采集当前点' })).toBeDisabled();
  });

  it('marks showcase examples explicitly and never enables execution', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '展示示例' }));

    expect(useActionProgramStore.getState().draft).toMatchObject({
      source: 'showcaseExample',
      waypoints: [{ source: 'showcaseExample', capturedAtUtc: null }]
    });
    expect(screen.getByText('SHOWCASE EXAMPLE')).toBeInTheDocument();
    expect(screen.getByText(/不是实机示教点或安全姿态/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行程序/ })).toBeDisabled();
  });

  it('keeps execution disabled until a fresh six-axis measured start pose exists', () => {
    const program = validProgram();
    program.waypoints = [{
      waypointId: '6c899952-10e8-4a4f-97a1-13de0cd00a03', name: '手动点 1', positionsDeg: [1, 2, 3, 4, 5, 6],
      mode: 2, postArrivalWait: { kind: 'none' }, notes: '', source: 'manual', capturedAtUtc: null
    }];
    act(() => {
      useActionProgramStore.getState().setDraft(program, 'imported');
      useGatewayRuntimeStore.getState().setCapabilities({
        contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
        readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: true,
        commandPolicy: 'engineering', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
        supportedCommands: ['enable', 'stopAndDisable', 'setMode'], jointGroupSpeedLimitDegS: null,
        jointGroupCompletion: null, engineeringJointSpeedMaxDegS: 100
      });
      useGatewayRuntimeStore.getState().setSession({
        sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
        controlMode: 2, timestampUtc: '2026-08-19T00:00:00.000Z', source: 'measured', validity: 'valid'
      });
    });

    renderPage();

    expect(screen.getByText(/需要新鲜有效的六轴 #GETJPOS 起始角/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行程序' })).toBeDisabled();
  });

  it('rejects unsupported imports and exports only schema-valid documents with URL cleanup', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aethor-action');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderPage();

    const invalid = new File([JSON.stringify({ schemaVersion: '2.0' })], 'legacy.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('导入动作 JSON 文件'), { target: { files: [invalid] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('不会静默迁移');
    expect(useActionProgramStore.getState().draft).toBeNull();

    act(() => useActionProgramStore.getState().setDraft(validProgram(), 'imported'));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:aethor-action');
  });

  it('rejects oversized imports before reading their content', async () => {
    renderPage();
    const oversized = new File(['{}'], 'oversized.json', { type: 'application/json' });
    Object.defineProperty(oversized, 'size', { value: 1024 * 1024 + 1 });
    const text = vi.spyOn(oversized, 'text');

    fireEvent.change(screen.getByLabelText('导入动作 JSON 文件'), { target: { files: [oversized] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('未读取文件内容');
    expect(text).not.toHaveBeenCalled();
  });

  it('duplicates the current dirty draft without discarding its edits or prompting', () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    fireEvent.change(screen.getByLabelText('动作程序名称'), { target: { value: 'Unsaved inspection' } });

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(useActionProgramStore.getState().draft).toMatchObject({
      name: 'Unsaved inspection 副本',
      revision: 1,
      source: 'authored'
    });
    expect(screen.getByText('AUTO-SAVING')).toBeInTheDocument();
  });

  it('never blocks page exit and deletes a waypoint without confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const rendered = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    fireEvent.click(screen.getByRole('button', { name: '添加目标草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 点位 01' }));
    expect(useActionProgramStore.getState().draft?.waypoints).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(false);
    rendered.unmount();
  });

  it('submits the exact authored waypoint snapshot at 20 deg/s and exposes loop stop control', async () => {
    const program = validProgram();
    program.loopEnabled = true;
    program.waypoints = [{
      waypointId: '6c899952-10e8-4a4f-97a1-13de0cd00a02', name: '示教点 1', positionsDeg: [181, 95, -45, 200, -150, 900],
      mode: 2, postArrivalWait: { kind: 'durationAfterConfirmed', durationMs: 500 }, notes: '',
      source: 'measuredCapture', capturedAtUtc: '2026-08-19T00:00:00.000Z'
    }];
    act(() => {
      useActionProgramStore.getState().setDraft(program, 'imported');
      useGatewayRuntimeStore.getState().setCapabilities({
        contractVersion: '1.4', protocolAdapterId: 'dummy-ascii-v1', serialEnumeration: true,
        readOnlyConnection: true, liveTelemetry: true, hardwareCommands: true, directCommand: true,
        commandPolicy: 'engineering', allowedQueries: ['#GETJPOS', '#GETMODE', '#GETENABLE'],
        supportedCommands: ['enable', 'stopAndDisable', 'setMode'], jointGroupSpeedLimitDegS: null,
        jointGroupCompletion: null, engineeringJointSpeedMaxDegS: 100
      });
      useGatewayRuntimeStore.getState().setSession({
        sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'enabled',
        controlMode: 2, timestampUtc: '2026-08-19T00:00:00.000Z', source: 'measured', validity: 'valid'
      });
      useGatewayRuntimeStore.getState().setJointState({
        sequence: 1, profileId: 'dummy-6dof', positionsDeg: [0, 0, 0, 0, 0, 0],
        timestampUtc: '2026-08-19T00:00:00.000Z', source: 'measured', validity: 'valid'
      });
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const startActionProgram = vi.fn(async (request) => ({
      contractVersion: '1.0' as const, runId: request.runId, programId: request.programId,
      revision: request.revision, sessionId: request.sessionId, profileId: 'dummy-6dof' as const,
      state: 'starting' as const, currentWaypointIndex: null, waypointCount: 1, completedCycles: 0,
      loopEnabled: true, speedDegS: 20, lastRequestId: null, lastEvidence: 'none' as const,
      physicalCompletionConfirmed: false as const, message: 'starting',
      startedAtUtc: '2026-08-19T00:00:00.000Z', updatedAtUtc: '2026-08-19T00:00:00.000Z', finishedAtUtc: null
    }));
    const stopActionProgram = vi.fn(async () => ({
      ...(await startActionProgram.mock.results[0]!.value), state: 'stoppedUnconfirmed' as const,
      lastRequestId: 'run-disable', lastEvidence: 'transportWritten' as const,
      finishedAtUtc: '2026-08-19T00:00:02.000Z'
    }));
    const gateway = { startActionProgram, stopActionProgram } as unknown as RobotGatewayV1;
    renderPage(gateway);

    expect(screen.getByText(/动作程序可提交/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行程序' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '运行程序' }));
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(startActionProgram).toHaveBeenCalledOnce());
    expect(startActionProgram).toHaveBeenCalledWith(expect.objectContaining({
      programId: program.programId, sessionId: 'session-1', speedDegS: 20, loopEnabled: true,
      waypoints: [{
        waypointId: '6c899952-10e8-4a4f-97a1-13de0cd00a02', name: '示教点 1', positionsDeg: [181, 95, -45, 200, -150, 900],
        mode: 2, postDispatchWaitMs: 500, source: 'measuredCapture'
      }]
    }));
    expect(screen.getByRole('button', { name: '停止程序' })).toBeEnabled();
    expect(screen.getByText(/未确认物理到位/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '停止程序' }));
    await waitFor(() => expect(stopActionProgram).toHaveBeenCalledOnce());
  });
});

function renderPage(gateway?: RobotGatewayV1) {
  return render(<Tooltip.Provider>{gateway
    ? <ActionProgrammingPage gateway={gateway} />
    : <ActionProgrammingPage />}</Tooltip.Provider>);
}

function validProgram(): ActionProgramV1 {
  return createActionProgramV1({
    programId: '6c899952-10e8-4a4f-97a1-13de0cd00a01',
    name: 'Imported cycle',
    timestampUtc: '2026-08-09T00:00:00.000Z'
  });
}
