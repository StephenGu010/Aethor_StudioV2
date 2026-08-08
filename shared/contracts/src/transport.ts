export type TransportState = 'closed' | 'opening' | 'open' | 'faulted' | 'disposed';

export interface TransportStateEvent {
  state: TransportState;
  reason?: string;
}

export type TransportDataListener = (chunk: string) => void;
export type TransportStateListener = (event: TransportStateEvent) => void;

export interface AsciiTransport {
  readonly state: TransportState;
  open(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
  write(payload: string, signal?: AbortSignal): Promise<void>;
  onData(listener: TransportDataListener): () => void;
  onState(listener: TransportStateListener): () => void;
  dispose(): void;
}

export class TransportUnavailableError extends Error {
  constructor(message = 'transport is not open') {
    super(message);
    this.name = 'TransportUnavailableError';
  }
}

export class TransportCancelledError extends Error {
  constructor(message = 'transport operation was cancelled') {
    super(message);
    this.name = 'TransportCancelledError';
  }
}

export class TransportCapacityError extends Error {
  constructor(message = 'transport buffer capacity exceeded') {
    super(message);
    this.name = 'TransportCapacityError';
  }
}
