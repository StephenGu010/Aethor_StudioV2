import type * as THREE from 'three';

type LoadGeometry = (
  assetUrl: string,
  onLoad: (geometry: THREE.BufferGeometry) => void,
  onError: (error: unknown) => void
) => void;

interface GeometrySubscriber {
  onLoad: (geometry: THREE.BufferGeometry) => void;
  onError: (error: unknown) => void;
}

type GeometryEntry =
  | { state: 'loading'; subscribers: GeometrySubscriber[] }
  | { state: 'loaded'; geometry: THREE.BufferGeometry };

/**
 * Deduplicates immutable geometry within one robot-model lifetime. Ownership stays
 * with the resulting object graph, so this cache never disposes shared geometry.
 */
export class SharedGeometryLoadCache {
  private readonly entries = new Map<string, GeometryEntry>();

  constructor(private readonly loadGeometry: LoadGeometry) {}

  request(assetUrl: string, subscriber: GeometrySubscriber) {
    const existing = this.entries.get(assetUrl);
    if (existing?.state === 'loaded') {
      subscriber.onLoad(existing.geometry);
      return;
    }
    if (existing?.state === 'loading') {
      existing.subscribers.push(subscriber);
      return;
    }

    const pending: GeometryEntry = { state: 'loading', subscribers: [subscriber] };
    this.entries.set(assetUrl, pending);
    try {
      this.loadGeometry(
        assetUrl,
        (geometry) => this.resolve(assetUrl, pending, geometry),
        (error) => this.reject(assetUrl, pending, error)
      );
    } catch (error) {
      this.reject(assetUrl, pending, error);
    }
  }

  private resolve(assetUrl: string, pending: Extract<GeometryEntry, { state: 'loading' }>, geometry: THREE.BufferGeometry) {
    if (this.entries.get(assetUrl) !== pending) return;
    this.entries.set(assetUrl, { state: 'loaded', geometry });
    pending.subscribers.forEach((subscriber) => subscriber.onLoad(geometry));
  }

  private reject(assetUrl: string, pending: Extract<GeometryEntry, { state: 'loading' }>, error: unknown) {
    if (this.entries.get(assetUrl) !== pending) return;
    this.entries.delete(assetUrl);
    pending.subscribers.forEach((subscriber) => subscriber.onError(error));
  }
}
