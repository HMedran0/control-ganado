import { describe, expect, it } from 'vitest';

import { SHARED_PACKAGE_NAME } from './index.js';

// Prueba de ejemplo: solo comprueba que el canal de pruebas funciona de punta a punta.
// Las pruebas de dominio reales llegan en M0.2.
describe('@hato/shared', () => {
  it('expone el nombre del paquete', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@hato/shared');
  });
});
