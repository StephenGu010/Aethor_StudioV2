import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBootstrapV1, DesktopBridgeResponseV1 } from '@aethor/contracts';
import { createDesktopBridge, readDesktopBootstrap, unavailableDesktopBridge } from './desktopBridge';

describe('DesktopBridgeV1 adapter', () => {
  afterEach(() => vi.useRealTimers());

  it('fails closed outside WebView2 or with an unsafe bootstrap origin', () => {
    expect(createDesktopBridge(environment(undefined))).toBe(unavailableDesktopBridge);
    expect(readDesktopBootstrap({
      __AETHOR_DESKTOP_BOOTSTRAP__: {
        ...bootstrap(), gateway: { baseUrl: 'http://192.168.1.10:5127', sessionToken: 'A'.repeat(43) }
      }
    })).toBeNull();
  });

  it('correlates a versioned host response without exposing another bridge surface', async () => {
    let receive: ((event: MessageEvent<unknown>) => void) | undefined;
    const postMessage = vi.fn();
    const bridge = createDesktopBridge(environment(bootstrap(), {
      postMessage,
      addEventListener: (_type, listener) => { receive = listener; }
    }));

    const pending = bridge.minimize();
    const request = postMessage.mock.calls[0]?.[0];
    expect(request).toMatchObject({ contractVersion: '1.0', action: 'minimize' });
    receive?.({ data: {
      contractVersion: '1.0', requestId: request.requestId, ok: true
    } satisfies DesktopBridgeResponseV1 } as MessageEvent<unknown>);
    await expect(pending).resolves.toBe(true);
  });

  it('times out safely when the host does not acknowledge an operation', async () => {
    vi.useFakeTimers();
    const bridge = createDesktopBridge(environment(bootstrap(), {
      postMessage: vi.fn(), addEventListener: vi.fn()
    }));

    const pending = bridge.close();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(await Promise.race([pending, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
  });

  it('coalesces duplicate native operations while one acknowledgement is pending', async () => {
    let receive: ((event: MessageEvent<unknown>) => void) | undefined;
    const postMessage = vi.fn();
    const bridge = createDesktopBridge(environment(bootstrap(), {
      postMessage,
      addEventListener: (_type, listener) => { receive = listener; }
    }));

    const first = bridge.close();
    const second = bridge.close();
    expect(postMessage).toHaveBeenCalledOnce();
    const request = postMessage.mock.calls[0]?.[0];
    receive?.({ data: {
      contractVersion: '1.0', requestId: request.requestId, ok: true
    } satisfies DesktopBridgeResponseV1 } as MessageEvent<unknown>);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('uses the explicit diagnostics action and waits for the native save result', async () => {
    let receive: ((event: MessageEvent<unknown>) => void) | undefined;
    const postMessage = vi.fn();
    const bridge = createDesktopBridge(environment(bootstrap(), {
      postMessage,
      addEventListener: (_type, listener) => { receive = listener; }
    }));

    const pending = bridge.exportDiagnostics();
    const request = postMessage.mock.calls[0]?.[0];
    expect(request).toMatchObject({ contractVersion: '1.0', action: 'exportDiagnostics' });
    receive?.({ data: {
      contractVersion: '1.0', requestId: request.requestId, ok: true
    } satisfies DesktopBridgeResponseV1 } as MessageEvent<unknown>);

    await expect(pending).resolves.toBe(true);
  });
});

function bootstrap(): DesktopBootstrapV1 {
  return {
    contractVersion: '1.0', gateway: { baseUrl: 'http://127.0.0.1:5127', sessionToken: 'A'.repeat(43) },
    capabilities: {
      available: true, minimize: true, toggleMaximize: true, close: true, exportDiagnostics: true
    }
  };
}

function environment(value?: DesktopBootstrapV1, webview?: AethorWebViewBridge) {
  return {
    crypto: window.crypto,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    ...(value ? { __AETHOR_DESKTOP_BOOTSTRAP__: value } : {}),
    ...(webview ? { chrome: { webview } } : {})
  };
}
