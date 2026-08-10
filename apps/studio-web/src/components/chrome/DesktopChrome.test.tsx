import { fireEvent, render, screen } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridgeV1 } from '../../integrations/desktopBridge';
import { DesktopChrome } from './DesktopChrome';

describe('DesktopChrome', () => {
  it('keeps native operations disabled in an ordinary browser', () => {
    renderChrome(bridge(false));
    expect(screen.queryByText('FRONTEND SHOWCASE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化需要 WebView2 桌面壳' })).toBeDisabled();
  });

  it('uses only declared host operations for controls and the drag region', () => {
    const native = bridge(true);
    const { container } = renderChrome(native);
    expect(screen.queryByText('WINDOWS DESKTOP')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }));
    fireEvent.click(screen.getByRole('button', { name: '最大化或还原窗口' }));
    fireEvent.pointerDown(container.querySelector('.desktopChromeIdentity')!, { button: 0 });
    fireEvent.doubleClick(container.querySelector('.desktopChromeIdentity')!);

    expect(native.minimize).toHaveBeenCalledOnce();
    expect(native.beginDrag).toHaveBeenCalledOnce();
    expect(native.toggleMaximize).toHaveBeenCalledTimes(2);
  });
});

function renderChrome(value: DesktopBridgeV1) {
  return render(<Tooltip.Provider><DesktopChrome bridge={value} /></Tooltip.Provider>);
}

function bridge(available: boolean): DesktopBridgeV1 {
  return {
    capabilities: {
      available,
      minimize: available,
      toggleMaximize: available,
      close: available
    },
    minimize: vi.fn(async () => available),
    toggleMaximize: vi.fn(async () => available),
    close: vi.fn(async () => available),
    beginDrag: vi.fn(async () => available)
  };
}
