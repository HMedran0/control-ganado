import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  compareIsoDates,
  daysBetween,
  isAfter,
  isBefore,
  isIsoDate,
  isLeapYear,
  isWithin,
  isoDateFromInstant,
  isoDateFromParts,
  isoDateParts,
  lastDayOfMonth,
  maxIsoDate,
  minIsoDate,
  toIsoDate,
} from './date.js';
import { DomainError } from './errors.js';

const d = toIsoDate;

describe('isIsoDate', () => {
  it('acepta fechas reales', () => {
    expect(isIsoDate('2026-09-26')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('rechaza fechas que no existen en el calendario', () => {
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-04-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('2026-01-00')).toBe(false);
  });

  it('rechaza formatos distintos y valores que no son cadenas', () => {
    expect(isIsoDate('26/09/2026')).toBe(false);
    expect(isIsoDate('2026-9-26')).toBe(false);
    expect(isIsoDate('2026-09-26T00:00:00Z')).toBe(false);
    expect(isIsoDate(20260926)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(new Date(0))).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('devuelve la misma cadena cuando es válida', () => {
    expect(toIsoDate('2026-05-04')).toBe('2026-05-04');
  });

  it('lanza VALIDATION_FAILED con mensaje en español', () => {
    expect(() => toIsoDate('2025-02-29')).toThrowError(DomainError);
    try {
      toIsoDate('31/12/2026');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
      expect((error as DomainError).detail).toContain('AAAA-MM-DD');
    }
  });
});

describe('isoDateFromParts', () => {
  it('rellena con ceros', () => {
    expect(isoDateFromParts(2026, 1, 5)).toBe('2026-01-05');
    expect(isoDateFromParts(876, 12, 31)).toBe('0876-12-31');
  });

  it('rechaza combinaciones imposibles', () => {
    expect(() => isoDateFromParts(2026, 2, 30)).toThrowError(DomainError);
    expect(() => isoDateFromParts(2026, 2, 1.5)).toThrowError(DomainError);
  });
});

describe('isoDateParts', () => {
  it('descompone con el mes de 1 a 12', () => {
    expect(isoDateParts(d('2026-09-26'))).toEqual({ year: 2026, month: 9, day: 26 });
  });
});

describe('isLeapYear y lastDayOfMonth', () => {
  it('aplica la regla gregoriana', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('da el último día de cada mes', () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2025, 2)).toBe(28);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 1)).toBe(31);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });
});

describe('addDays', () => {
  it('cruza meses y años', () => {
    expect(addDays(d('2026-09-26'), 5)).toBe('2026-10-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-01-01'), -1)).toBe('2025-12-31');
  });

  it('cuenta el 29 de febrero en los años bisiestos', () => {
    expect(addDays(d('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(d('2025-02-28'), 1)).toBe('2025-03-01');
  });

  it('suma la gestación completa sin desviarse', () => {
    // 293 días de gestación cebuina desde un servicio de marzo de un año bisiesto.
    expect(addDays(d('2024-03-15'), 293)).toBe('2025-01-02');
  });
});

describe('addMonths', () => {
  it('recorta al último día del mes de destino (ADR-002)', () => {
    expect(addMonths(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(d('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(d('2026-08-31'), 3)).toBe('2026-11-30');
  });

  it('cruza el año en ambos sentidos', () => {
    expect(addMonths(d('2026-11-15'), 3)).toBe('2027-02-15');
    expect(addMonths(d('2026-02-15'), -3)).toBe('2025-11-15');
    expect(addMonths(d('2026-02-15'), -14)).toBe('2024-12-15');
  });

  it('no es simétrica en los bordes, y es a propósito', () => {
    const recortada = addMonths(d('2026-01-31'), 1);
    expect(addMonths(recortada, 1)).toBe('2026-03-28');
  });
});

describe('daysBetween', () => {
  it('cuenta días completos, con signo', () => {
    expect(daysBetween(d('2026-09-01'), d('2026-09-26'))).toBe(25);
    expect(daysBetween(d('2026-09-26'), d('2026-09-01'))).toBe(-25);
    expect(daysBetween(d('2026-09-26'), d('2026-09-26'))).toBe(0);
  });

  it('cuenta 366 días en un año bisiesto y 365 en uno común', () => {
    expect(daysBetween(d('2024-01-01'), d('2025-01-01'))).toBe(366);
    expect(daysBetween(d('2025-01-01'), d('2026-01-01'))).toBe(365);
  });
});

describe('comparación', () => {
  it('ordena cronológicamente', () => {
    expect(compareIsoDates(d('2026-01-01'), d('2026-01-02'))).toBe(-1);
    expect(compareIsoDates(d('2026-01-02'), d('2026-01-01'))).toBe(1);
    expect(compareIsoDates(d('2026-01-01'), d('2026-01-01'))).toBe(0);
    expect(isBefore(d('2026-01-01'), d('2026-01-02'))).toBe(true);
    expect(isAfter(d('2026-01-01'), d('2026-01-02'))).toBe(false);
  });

  it('isWithin incluye los extremos', () => {
    const start = d('2026-05-04');
    const end = d('2026-06-23');
    expect(isWithin(start, start, end)).toBe(true);
    expect(isWithin(end, start, end)).toBe(true);
    expect(isWithin(d('2026-05-20'), start, end)).toBe(true);
    expect(isWithin(d('2026-05-03'), start, end)).toBe(false);
    expect(isWithin(d('2026-06-24'), start, end)).toBe(false);
  });

  it('min y max con varias fechas', () => {
    expect(minIsoDate(d('2026-03-01'), d('2026-01-01'), d('2026-02-01'))).toBe('2026-01-01');
    expect(maxIsoDate(d('2026-03-01'), d('2026-01-01'), d('2026-02-01'))).toBe('2026-03-01');
    expect(minIsoDate(d('2026-03-01'))).toBe('2026-03-01');
  });

  it('ordena igual como texto que como fecha', () => {
    const fechas = [d('2026-10-01'), d('2026-02-09'), d('2026-02-10'), d('2025-12-31')];
    expect([...fechas].sort()).toEqual(['2025-12-31', '2026-02-09', '2026-02-10', '2026-10-01']);
  });
});

describe('isoDateFromInstant', () => {
  it('da el día local de la zona, no el de UTC', () => {
    // Medianoche UTC del 26 es el 25 a las 19:00 en Bogotá.
    const instant = new Date('2026-09-26T00:00:00Z');
    expect(isoDateFromInstant(instant, 'UTC')).toBe('2026-09-26');
    expect(isoDateFromInstant(instant, 'America/Bogota')).toBe('2026-09-25');
    expect(isoDateFromInstant(instant, 'Asia/Tokyo')).toBe('2026-09-26');
  });

  it('cruza el día en Tokio y no en Bogotá', () => {
    const instant = new Date('2026-09-26T16:00:00Z');
    expect(isoDateFromInstant(instant, 'America/Bogota')).toBe('2026-09-26');
    expect(isoDateFromInstant(instant, 'Asia/Tokyo')).toBe('2026-09-27');
  });
});
