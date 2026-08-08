import type { DesktopBridgeCapabilities } from '@aethor/contracts';

export interface DesktopBridgeV1 {
  readonly capabilities: DesktopBridgeCapabilities;
  minimize(): Promise<boolean>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<boolean>;
}

export const unavailableDesktopBridge: DesktopBridgeV1 = {
  capabilities: { available: false, minimize: false, toggleMaximize: false, close: false },
  minimize: async () => false,
  toggleMaximize: async () => false,
  close: async () => false
};
