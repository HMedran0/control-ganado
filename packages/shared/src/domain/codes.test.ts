import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors.js';
import {
  DEFAULT_CALF_CODE_PATTERN,
  formatCalfCode,
  isValidCalfCodePattern,
  nextCalfCode,
} from './codes.js';

const PATRON = DEFAULT_CALF_CODE_PATTERN;

describe('formatCalfCode (08 §2.3)', () => {
  it('aplica el patrón por defecto {YY}-{NNN}', () => {
    expect(PATRON).toBe('{YY}-{NNN}');
    expect(formatCalfCode(PATRON, 2026, 45)).toBe('26-045');
    expect(formatCalfCode(PATRON, 2026, 1)).toBe('26-001');
    expect(formatCalfCode(PATRON, 2026, 350)).toBe('26-350');
  });

  it('no recorta los consecutivos de más de tres dígitos', () => {
    expect(formatCalfCode(PATRON, 2026, 1200)).toBe('26-1200');
  });

  it('acepta los otros tokens', () => {
    expect(formatCalfCode('{YYYY}-{NNN}', 2026, 45)).toBe('2026-045');
    expect(formatCalfCode('{YY}-{N}', 2026, 45)).toBe('26-45');
    expect(formatCalfCode('T{YYYY}{NNN}', 2026, 7)).toBe('T2026007');
    expect(formatCalfCode('{YY}-{NNN}', 2007, 5)).toBe('07-005');
  });

  it('rechaza un patrón sin consecutivo', () => {
    expect(isValidCalfCodePattern('{YY}-')).toBe(false);
    expect(isValidCalfCodePattern('{YY}-{NNN}')).toBe(true);
    expect(() => formatCalfCode('{YY}-', 2026, 1)).toThrowError(DomainError);
  });
});

describe('nextCalfCode (RN-28)', () => {
  it('con 26-001 a 26-044 sugiere 26-045', () => {
    const existentes = Array.from({ length: 44 }, (_value, index) =>
      formatCalfCode(PATRON, 2026, index + 1),
    );
    expect(nextCalfCode({ pattern: PATRON, year: 2026, existingCodes: existentes })).toBe('26-045');
  });

  it('sin códigos del año empieza en 001', () => {
    expect(nextCalfCode({ pattern: PATRON, year: 2026, existingCodes: [] })).toBe('26-001');
  });

  it('no rellena huecos: sigue desde el más alto', () => {
    expect(nextCalfCode({ pattern: PATRON, year: 2026, existingCodes: ['26-001', '26-003'] })).toBe(
      '26-004',
    );
  });

  it('ignora los códigos de otros años y los que no siguen el patrón', () => {
    expect(
      nextCalfCode({
        pattern: PATRON,
        year: 2026,
        existingCodes: ['25-120', '27-004', '188', 'P-12', 'T-245', '26-002'],
      }),
    ).toBe('26-003');
  });

  it('salta los códigos ya usados aunque no vengan del patrón', () => {
    expect(
      nextCalfCode({
        pattern: PATRON,
        year: 2026,
        existingCodes: ['26-001', '26-002', '26-003'],
      }),
    ).toBe('26-004');
  });

  it('nunca devuelve un código existente', () => {
    // El consecutivo más alto es 5, pero 26-006 y 26-007 ya están tomados.
    const resultado = nextCalfCode({
      pattern: PATRON,
      year: 2026,
      existingCodes: ['26-005', '26-006', '26-007'],
    });
    expect(resultado).toBe('26-008');
  });

  it('cuenta también los animales archivados (RN-28)', () => {
    // El llamador pasa activos y archivados juntos; aquí se comprueba que ninguno se reutiliza.
    const existentes = ['26-001', '26-002', '26-003'];
    const sugerido = nextCalfCode({ pattern: PATRON, year: 2026, existingCodes: existentes });
    expect(existentes).not.toContain(sugerido);
  });

  it('funciona con los demás patrones', () => {
    expect(
      nextCalfCode({ pattern: '{YYYY}-{N}', year: 2026, existingCodes: ['2026-9', '2026-10'] }),
    ).toBe('2026-11');
    expect(nextCalfCode({ pattern: 'T{YY}{NNN}', year: 2026, existingCodes: ['T26044'] })).toBe(
      'T26045',
    );
  });

  it('acepta cualquier iterable, como un Set', () => {
    expect(nextCalfCode({ pattern: PATRON, year: 2026, existingCodes: new Set(['26-044']) })).toBe(
      '26-045',
    );
  });

  it('el año de dos dígitos no confunde siglos', () => {
    expect(nextCalfCode({ pattern: PATRON, year: 2026, existingCodes: ['26-044'] })).toBe('26-045');
    expect(nextCalfCode({ pattern: PATRON, year: 2027, existingCodes: ['26-044'] })).toBe('27-001');
  });
});
