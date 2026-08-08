import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { FloatingToolWindow } from './FloatingToolWindow';

describe('FloatingToolWindow resource lifetime', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().resetLayout();
    useWorkbenchStore.getState().toggleWindow('modelTree');
  });

  afterEach(() => {
    useWorkbenchStore.getState().resetLayout();
    vi.restoreAllMocks();
  });

  it('removes window drag listeners when unmounted during an active drag', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <div className="sceneStage">
        <FloatingToolWindow id="modelTree" title="模型结构">content</FloatingToolWindow>
      </div>
    );
    const header = screen.getByRole('dialog', { name: '模型结构' }).querySelector<HTMLElement>('.toolWindowHeader');
    expect(header).not.toBeNull();
    Object.defineProperty(header, 'setPointerCapture', { value: vi.fn(), configurable: true });
    fireEvent.pointerDown(header!, { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
    expect(addListener).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();

    expect(removeListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
  });
});
