import type { ActionProgramV1 } from '@aethor/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionProgramV1 } from '../../domain/actionProgram';
import { useActionProgramStore } from '../../stores/useActionProgramStore';
import { useGatewayRuntimeStore } from '../../stores/useGatewayRuntimeStore';
import { useRobotSessionStore } from '../../stores/useRobotSessionStore';
import { ActionProgrammingPage } from './ActionProgrammingPage';

describe('ActionProgrammingPage offline editor', () => {
  beforeEach(() => {
    localStorage.clear();
    useActionProgramStore.getState().resetActionPrograms();
    useGatewayRuntimeStore.getState().resetRuntime();
    useRobotSessionStore.getState().resetSession();
    vi.restoreAllMocks();
  });

  it('creates, edits, previews, and explicitly saves a local action document without an execution path', () => {
    renderPage();

    expect(screen.getByText('NO EXECUTION PATH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行程序/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    expect(screen.getByText('DRAFT DIRTY')).toBeInTheDocument();
    expect(localStorage.getItem('aethor-studio-v2-action-programs')).not.toContain('未命名动作程序');

    fireEvent.change(screen.getByLabelText('动作程序名称'), { target: { value: 'Inspection cycle' } });
    fireEvent.click(screen.getByRole('button', { name: '添加目标草稿' }));
    expect(screen.getByText('点位 01')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('J1 点位角度'), { target: { value: '200' } });
    expect(useActionProgramStore.getState().draft?.waypoints[0]?.positionsDeg[0]).toBe(179.91);

    fireEvent.click(screen.getByRole('button', { name: '加载到 Dummy 本地目标草稿' }));
    expect(useRobotSessionStore.getState().targetPositionsDeg[0]).toBe(179.91);
    expect(screen.getByText('TARGET PREVIEW · NO SEND')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('SAVED REVISION')).toBeInTheDocument();
    expect(localStorage.getItem('aethor-studio-v2-action-programs')).toContain('Inspection cycle');
    expect(screen.getByRole('button', { name: /运行程序/ })).toBeDisabled();
  });

  it('keeps measured capture disabled for showcase data and records only fresh measured feedback', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    expect(screen.getByRole('button', { name: '采集当前点' })).toBeDisabled();

    act(() => {
      useGatewayRuntimeStore.getState().setSession({
        sessionId: 'session-1', profileId: 'dummy-6dof', connectionState: 'connected', motorState: 'disabled',
        controlMode: 2, timestampUtc: '2026-08-09T01:00:00.000Z', source: 'measured', validity: 'valid'
      });
      useGatewayRuntimeStore.getState().setJointState({
        sequence: 4, profileId: 'dummy-6dof', timestampUtc: '2026-08-09T01:00:01.000Z',
        positionsDeg: [1, 2, 3, 4, 5, 6], source: 'measured', validity: 'valid'
      });
    });

    expect(screen.getByRole('button', { name: '采集当前点' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '采集当前点' }));
    expect(useActionProgramStore.getState().draft?.waypoints[0]).toMatchObject({
      positionsDeg: [1, 2, 3, 4, 5, 6],
      source: 'measuredCapture',
      capturedAtUtc: '2026-08-09T01:00:01.000Z'
    });
    expect(screen.getByText('MEASURED CAPTURE')).toBeInTheDocument();
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
    expect(screen.getByText('DRAFT DIRTY')).toBeInTheDocument();
  });

  it('installs a beforeunload guard only while the current draft is dirty', () => {
    const rendered = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '新建空白程序' }));
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const savedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savedEvent);
    expect(savedEvent.defaultPrevented).toBe(false);
    rendered.unmount();
  });
});

function renderPage() {
  return render(<Tooltip.Provider><ActionProgrammingPage /></Tooltip.Provider>);
}

function validProgram(): ActionProgramV1 {
  return createActionProgramV1({
    programId: '6c899952-10e8-4a4f-97a1-13de0cd00a01',
    name: 'Imported cycle',
    timestampUtc: '2026-08-09T00:00:00.000Z'
  });
}
