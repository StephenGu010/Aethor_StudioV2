import type {
  DesktopBootstrapV1,
  DesktopBridgeAction,
  DesktopBridgeCapabilities,
  DesktopBridgeRequestV1
} from '@aethor/contracts';
import { z } from 'zod';

export interface DesktopBridgeV1 {
  readonly capabilities: DesktopBridgeCapabilities;
  minimize(): Promise<boolean>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<boolean>;
  beginDrag(): Promise<boolean>;
  exportDiagnostics(): Promise<boolean>;
}

interface DesktopEnvironment {
  __AETHOR_DESKTOP_BOOTSTRAP__?: unknown;
  chrome?: { webview?: AethorWebViewBridge };
  crypto: Pick<Crypto, 'randomUUID'>;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
}

const capabilitiesSchema = z.object({
  available: z.boolean(), minimize: z.boolean(), toggleMaximize: z.boolean(), close: z.boolean(),
  exportDiagnostics: z.boolean()
}).strict();
const bootstrapSchema = z.object({
  contractVersion: z.literal('1.0'),
  gateway: z.object({
    baseUrl: z.string().url().refine(isLoopbackOrigin, 'Desktop gateway must be a loopback origin'),
    sessionToken: z.string().min(32).max(256).regex(/^[!-~]+$/)
  }).strict().nullable(),
  capabilities: capabilitiesSchema
}).strict();
const responseSchema = z.object({
  contractVersion: z.literal('1.0'),
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  errorCode: z.enum(['unsupported', 'invalidRequest', 'hostFailure']).optional()
}).strict();

export const unavailableDesktopBridge: DesktopBridgeV1 = {
  capabilities: {
    available: false, minimize: false, toggleMaximize: false, close: false, exportDiagnostics: false
  },
  minimize: async () => false,
  toggleMaximize: async () => false,
  close: async () => false,
  beginDrag: async () => false,
  exportDiagnostics: async () => false
};

export function readDesktopBootstrap(
  environment: Pick<DesktopEnvironment, '__AETHOR_DESKTOP_BOOTSTRAP__'> = window
): DesktopBootstrapV1 | null {
  const parsed = bootstrapSchema.safeParse(environment.__AETHOR_DESKTOP_BOOTSTRAP__);
  return parsed.success ? parsed.data : null;
}

export function createDesktopBridge(environment: DesktopEnvironment = window): DesktopBridgeV1 {
  const bootstrap = readDesktopBootstrap(environment);
  const webview = environment.chrome?.webview;
  if (!bootstrap || !webview || !bootstrap.capabilities.available) return unavailableDesktopBridge;
  return new WebViewDesktopBridge(bootstrap.capabilities, webview, environment);
}

class WebViewDesktopBridge implements DesktopBridgeV1 {
  private readonly pending = new Map<string, (value: boolean) => void>();
  private readonly inFlight = new Map<DesktopBridgeAction, Promise<boolean>>();

  constructor(
    readonly capabilities: DesktopBridgeCapabilities,
    private readonly webview: AethorWebViewBridge,
    private readonly environment: Pick<DesktopEnvironment, 'crypto' | 'setTimeout' | 'clearTimeout'>
  ) {
    webview.addEventListener('message', (event) => this.handleResponse(event.data));
  }

  minimize() { return this.invoke('minimize', this.capabilities.minimize); }
  toggleMaximize() { return this.invoke('toggleMaximize', this.capabilities.toggleMaximize); }
  close() { return this.invoke('close', this.capabilities.close, 10_000); }
  beginDrag() { return this.invoke('beginDrag', this.capabilities.available); }
  exportDiagnostics() { return this.invoke('exportDiagnostics', this.capabilities.exportDiagnostics, 120_000); }

  private invoke(action: DesktopBridgeAction, supported: boolean, timeoutMs = 2_000) {
    if (!supported) return Promise.resolve(false);
    const existing = this.inFlight.get(action);
    if (existing) return existing;
    const requestId = this.environment.crypto.randomUUID();
    const request: DesktopBridgeRequestV1 = { contractVersion: '1.0', requestId, action };
    const operation = new Promise<boolean>((resolve) => {
      const timeout = this.environment.setTimeout(() => {
        this.pending.delete(requestId);
        resolve(false);
      }, timeoutMs);
      this.pending.set(requestId, (value) => {
        this.environment.clearTimeout(timeout);
        resolve(value);
      });
      try {
        this.webview.postMessage(request);
      } catch {
        this.pending.delete(requestId);
        this.environment.clearTimeout(timeout);
        resolve(false);
      }
    });
    this.inFlight.set(action, operation);
    void operation.finally(() => this.inFlight.delete(action));
    return operation;
  }

  private handleResponse(value: unknown) {
    const parsed = responseSchema.safeParse(value);
    if (!parsed.success) return;
    const response = parsed.data;
    const receiver = this.pending.get(response.requestId);
    if (!receiver) return;
    this.pending.delete(response.requestId);
    receiver(response.ok);
  }
}

// Initialize only after the concrete class has left its temporal dead zone.
// Browser mode never instantiated the class and therefore could not expose
// this ordering defect; WebView2 does so during module evaluation.
export const desktopBridge = createDesktopBridge();

function isLoopbackOrigin(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.origin === value;
  } catch {
    return false;
  }
}
