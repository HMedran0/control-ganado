import { describe, expect, it } from 'vitest';

import { BOTTOM_NAV, MORE_NAV, SIDEBAR_NAV, visibleFor } from './nav-items';

const labels = (items: readonly { label: string }[]): string[] => items.map((item) => item.label);

describe('navegación por rol', () => {
  it('la barra inferior tiene los cinco destinos de 06 §4, con Registrar al centro', () => {
    expect(labels(BOTTOM_NAV)).toEqual(['Inicio', 'Animales', 'Registrar', 'Alertas', 'Más']);
  });

  it('el administrador ve Finanzas y Configuración', () => {
    expect(labels(visibleFor(SIDEBAR_NAV, 'ADMIN'))).toEqual(
      expect.arrayContaining(['Finanzas', 'Configuración']),
    );
    expect(labels(visibleFor(MORE_NAV, 'ADMIN'))).toEqual(
      expect.arrayContaining(['Finanzas', 'Configuración']),
    );
  });

  it.each(['OPERATOR', 'VET'] as const)('%s no ve Finanzas ni Configuración', (role) => {
    for (const items of [SIDEBAR_NAV, MORE_NAV, BOTTOM_NAV]) {
      const visible = labels(visibleFor(items, role));
      expect(visible).not.toContain('Finanzas');
      expect(visible).not.toContain('Configuración');
    }
    expect(labels(visibleFor(MORE_NAV, role))).toEqual(['Jornadas', 'Reportes', 'Mi cuenta']);
  });
});
