import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals: true`, Testing Library no desmonta solo entre pruebas.
afterEach(() => {
  cleanup();
});

// jsdom no implementa ResizeObserver, y Radix lo usa para medir el control oculto de un grupo
// de opciones dentro de un <form>. En las pruebas basta con uno que no mide nada.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// Tampoco implementa la captura de punteros, que Radix Toast usa para el gesto de deslizar.
for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, { value: () => false, configurable: true });
  }
}
