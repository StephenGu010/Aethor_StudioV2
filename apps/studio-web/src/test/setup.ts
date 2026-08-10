import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, writable: true });

// jsdom does not implement the pointer-capture and scrolling primitives used by
// Radix Select. Browser E2E still exercises the native implementations.
Object.defineProperties(HTMLElement.prototype, {
  scrollIntoView: { value: () => {}, writable: true },
  hasPointerCapture: { value: () => false, writable: true },
  setPointerCapture: { value: () => {}, writable: true },
  releasePointerCapture: { value: () => {}, writable: true }
});
