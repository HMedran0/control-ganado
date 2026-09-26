import { describe, expect, it } from 'vitest';
import { toIsoDate } from '@hato/shared';

import {
  fromPrismaDate,
  fromPrismaDateOrNull,
  toPrismaDate,
  toPrismaDateOrNull,
} from './date-mapper.js';

describe('conversión de fechas de negocio', () => {
  it('convierte a medianoche UTC', () => {
    expect(toPrismaDate(toIsoDate('2026-03-01')).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(toPrismaDate(toIsoDate('2024-02-29')).toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('lee el día en UTC, no en la hora local', () => {
    expect(fromPrismaDate(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03-01');
    // Aunque el instante caiga tarde en el día UTC, el día es el mismo.
    expect(fromPrismaDate(new Date('2026-03-01T23:59:59.000Z'))).toBe('2026-03-01');
  });

  it('la ida y la vuelta son inversas', () => {
    for (const fecha of ['2026-01-01', '2026-01-31', '2026-03-01', '2024-02-29', '2025-12-31']) {
      const iso = toIsoDate(fecha);
      expect(fromPrismaDate(toPrismaDate(iso))).toBe(fecha);
    }
  });

  it('no depende de la zona horaria del proceso', () => {
    // La zona real la fija `pnpm test:tz`; esta prueba documenta la propiedad y falla si
    // alguien reescribe la conversión con captadores locales.
    const iso = toIsoDate('2026-03-01');
    const asDate = toPrismaDate(iso);
    expect(asDate.getUTCDate()).toBe(1);
    expect(asDate.getUTCMonth()).toBe(2);
    expect(fromPrismaDate(asDate)).toBe('2026-03-01');
  });

  it('acepta nulos', () => {
    expect(toPrismaDateOrNull(null)).toBeNull();
    expect(toPrismaDateOrNull(undefined)).toBeNull();
    expect(fromPrismaDateOrNull(null)).toBeNull();
    expect(fromPrismaDateOrNull(undefined)).toBeNull();
    expect(toPrismaDateOrNull(toIsoDate('2026-03-01'))?.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(fromPrismaDateOrNull(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03-01');
  });
});
