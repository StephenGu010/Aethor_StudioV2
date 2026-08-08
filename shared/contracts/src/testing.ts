import type { AsciiTransport, TransportDataListener, TransportState, TransportStateListener } from './transport';
import { TransportCancelledError, TransportCapacityError, TransportUnavailableError } from './transport';

export interface FakeAsciiTransportOptions {
  maxWrites?: number;
}

export class FakeAsciiTransport implements AsciiTransport {
  private currentState: TransportState = 'closed';
  private readonly dataListeners = new Set<TransportDataListener>();
  private readonly stateListeners = new Set<TransportStateListener>();
  private readonly writes: string[] = [];
  private readonly maxWrites: number;

  constructor(options: FakeAsciiTransportOptions = {}) {
    this.maxWrites = options.maxWrites ?? 64;
    if (!Number.isInteger(this.maxWrites) || this.maxWrites < 1) throw new Error('maxWrites must be a positive integer');
  }

  get state(): TransportState {
    return this.currentState;
  }

  async open(signal?: AbortSignal): Promise<void> {
    this.throwIfDisposed();
    throwIfCancelled(signal);
    if (this.currentState === 'open') return;
    this.setState('opening');
    throwIfCancelled(signal);
    this.setState('open');
  }

  async close(): Promise<void> {
    if (this.currentState === 'disposed' || this.currentState === 'closed') return;
    this.setState('closed');
  }

  async write(payload: string, signal?: AbortSignal): Promise<void> {
    this.throwIfDisposed();
    throwIfCancelled(signal);
    if (this.currentState !== 'open') throw new TransportUnavailableError();
    if (this.writes.length >= this.maxWrites) throw new TransportCapacityError();
    this.writes.push(payload);
  }

  onData(listener: TransportDataListener): () => void {
    this.throwIfDisposed();
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onState(listener: TransportStateListener): () => void {
    this.throwIfDisposed();
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  injectReceivedChunk(chunk: string): void {
    this.throwIfDisposed();
    if (this.currentState !== 'open') throw new TransportUnavailableError('cannot receive while transport is closed');
    for (const listener of [...this.dataListeners]) listener(chunk);
  }

  injectFault(reason: string): void {
    this.throwIfDisposed();
    this.setState('faulted', reason);
  }

  writtenPayloads(): readonly string[] {
    return [...this.writes];
  }

  dispose(): void {
    if (this.currentState === 'disposed') return;
    this.dataListeners.clear();
    this.stateListeners.clear();
    this.writes.length = 0;
    this.currentState = 'disposed';
  }

  listenerCounts(): { data: number; state: number } {
    return { data: this.dataListeners.size, state: this.stateListeners.size };
  }

  private setState(state: TransportState, reason?: string): void {
    this.currentState = state;
    const event = { state, ...(reason === undefined ? {} : { reason }) };
    for (const listener of [...this.stateListeners]) listener(event);
  }

  private throwIfDisposed(): void {
    if (this.currentState === 'disposed') throw new TransportUnavailableError('transport is disposed');
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TransportCancelledError();
}
