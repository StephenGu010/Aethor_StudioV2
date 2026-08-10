import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBootstrapV1 } from '@aethor/contracts';

describe('DesktopBridgeV1 module initialization', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__AETHOR_DESKTOP_BOOTSTRAP__');
    Reflect.deleteProperty(window, 'chrome');
    vi.resetModules();
  });

  it('constructs the singleton when WebView2 bootstrap exists before module evaluation', async () => {
    const bootstrap: DesktopBootstrapV1 = {
      contractVersion: '1.0',
      gateway: null,
      capabilities: { available: true, minimize: true, toggleMaximize: true, close: true }
    };
    Object.defineProperty(window, '__AETHOR_DESKTOP_BOOTSTRAP__', {
      value: bootstrap, configurable: true
    });
    Object.defineProperty(window, 'chrome', {
      value: { webview: { postMessage: vi.fn(), addEventListener: vi.fn() } },
      configurable: true
    });
    vi.resetModules();

    const module = await import('./desktopBridge');

    expect(module.desktopBridge.capabilities).toEqual(bootstrap.capabilities);
  });
});
