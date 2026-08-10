/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AETHOR_GATEWAY_URL?: string;
  readonly VITE_AETHOR_GATEWAY_SESSION_TOKEN?: string;
}

interface AethorWebViewBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

interface Window {
  __AETHOR_DESKTOP_BOOTSTRAP__?: unknown;
  chrome?: { webview?: AethorWebViewBridge };
}
