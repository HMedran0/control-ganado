import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { formatAge } from './age.js';
import { formatDate, formatOptionalDate } from './date.js';
import { formatCop } from './money.js';
import { formatDecimalEsCo, groupThousands, parseDecimalEsCo } from './number.js';
import { formatWeight } from './weight.js';

const d = toIsoDate;

describe('formatDate (RNF-13: dd/mm/aaaa)', () => {
  it('formatea con ceros a la izquierda', () => {
    expect(formatDate(d('2026-09-26'))).toBe('26/09/2026');
    expect(formatDate(d('2026-01-05'))).toBe('05/01/2026');
    expect(formatDate(d('2024-02-29'))).toBe('29/02/2024');
  });

  it('no depende de la zona horaria: el día es el de la cadena', () => {
    expect(formatDate(d('2026-03-01'))).toBe('01/03/2026');
  });

  it('formatOptionalDate usa una raya para las fechas ausentes', () => {
    expect(formatOptionalDate(null)).toBe('—');
    expect(formatOptionalDate(undefined)).toBe('—');
    expect(formatOptionalDate(null, 'Sin fecha')).toBe('Sin fecha');
    expect(formatOptionalDate(d('2026-09-26'))).toBe('26/09/2026');
  });
});

describe('groupThousands y formatDecimalEsCo', () => {
  it('separa los miles con punto', () => {
    expect(groupThousands('1250000')).toBe('1.250.000');
    expect(groupThousands('100')).toBe('100');
    expect(groupThousands('1000')).toBe('1.000');
    expect(groupThousands('0')).toBe('0');
  });

  it('usa coma decimal y recorta ceros cuando se le pide', () => {
    expect(formatDecimalEsCo('1250.50', 2, true)).toBe('1.250,5');
    expect(formatDecimalEsCo('1250.00', 2, true)).toBe('1.250');
    expect(formatDecimalEsCo('1250.00', 2, false)).toBe('1.250,00');
    expect(formatDecimalEsCo('0.05', 2, true)).toBe('0,05');
    expect(formatDecimalEsCo('-42.10', 2, true)).toBe('-42,1');
  });
});

describe('formatCop (RNF-13: COP sin decimales)', () => {
  it('muestra pesos enteros con separador de miles', () => {
    expect(formatCop('1250000.00')).toBe('$ 1.250.000');
    expect(formatCop('0.00')).toBe('$ 0');
    expect(formatCop('999.00')).toBe('$ 999');
  });

  it('redondea los centavos al peso más cercano', () => {
    expect(formatCop('33333.33')).toBe('$ 33.333');
    expect(formatCop('33333.50')).toBe('$ 33.334');
    expect(formatCop('33333.99')).toBe('$ 33.334');
  });

  it('acepta centavos en bigint y montos negativos', () => {
    expect(formatCop(3_333_400n)).toBe('$ 33.334');
    expect(formatCop('-1500.00')).toBe('-$ 1.500');
  });

  it('puede omitir el símbolo', () => {
    expect(formatCop('1250000.00', { symbol: false })).toBe('1.250.000');
  });
});

describe('formatWeight', () => {
  it('usa coma decimal y omite los ceros finales', () => {
    expect(formatWeight('425.50')).toBe('425,5 kg');
    expect(formatWeight('425.00')).toBe('425 kg');
    expect(formatWeight('1250.25')).toBe('1.250,25 kg');
    expect(formatWeight('38.60')).toBe('38,6 kg');
  });

  it('acepta números y permite quitar la unidad', () => {
    expect(formatWeight(425.5)).toBe('425,5 kg');
    expect(formatWeight('425.50', { unit: false })).toBe('425,5');
    expect(formatWeight('425.55', { maxDecimals: 1 })).toBe('425,5 kg');
  });
});

describe('formatAge (ANI-08 CA2)', () => {
  const nacimiento = d('2026-01-15');

  it('menos de un mes, en días', () => {
    expect(formatAge({ birthDate: nacimiento, today: d('2026-01-16') })).toBe('1 día');
    expect(formatAge({ birthDate: nacimiento, today: d('2026-02-02') })).toBe('18 días');
    expect(formatAge({ birthDate: nacimiento, today: d('2026-01-15') })).toBe('0 días');
  });

  it('el día en que cumple el mes pasa a meses', () => {
    expect(formatAge({ birthDate: nacimiento, today: d('2026-02-14') })).toBe('30 días');
    expect(formatAge({ birthDate: nacimiento, today: d('2026-02-15') })).toBe('1 mes');
  });

  it('menos de dos años, en meses', () => {
    expect(formatAge({ birthDate: nacimiento, today: d('2026-08-15') })).toBe('7 meses');
    expect(formatAge({ birthDate: nacimiento, today: d('2027-12-15') })).toBe('23 meses');
  });

  it('desde los dos años, «X a Y m»', () => {
    expect(formatAge({ birthDate: nacimiento, today: d('2028-01-15') })).toBe('2 a 0 m');
    expect(formatAge({ birthDate: nacimiento, today: d('2029-05-15') })).toBe('3 a 4 m');
    expect(formatAge({ birthDate: nacimiento, today: d('2033-01-14') })).toBe('6 a 11 m');
  });

  it('antepone ≈ si la fecha de nacimiento es aproximada', () => {
    expect(formatAge({ birthDate: nacimiento, today: d('2029-05-15'), estimated: true })).toBe(
      '≈ 3 a 4 m',
    );
    expect(formatAge({ birthDate: nacimiento, today: d('2026-02-02'), estimated: true })).toBe(
      '≈ 18 días',
    );
  });

  it('nacido el 29 de febrero: cumple años el 28 en los años comunes', () => {
    const bisiesto = d('2024-02-29');
    expect(formatAge({ birthDate: bisiesto, today: d('2026-02-28') })).toBe('2 a 0 m');
    expect(formatAge({ birthDate: bisiesto, today: d('2026-02-27') })).toBe('23 meses');
  });
});

describe('parseDecimalEsCo (NumberField)', () => {
  it.each([
    ['452,5', 1, '452.5'],
    ['1.250.000', 0, '1250000'],
    ['1.250.000', 2, '1250000'],
    ['1.250.000,75', 2, '1250000.75'],
    ['32', 1, '32'],
    ['0,5', 1, '0.5'],
    [',5', 1, '0.5'],
    ['007', 0, '7'],
    ['452,50', 1, '452.5'],
    ['452,0', 0, '452'],
    ['$ 1.250.000', 0, '1250000'],
    ['1 250 000', 0, '1250000'],
    [' 452,5 ', 2, '452.5'],
  ])('«%s» con %i decimales → %s', (text, decimals, expected) => {
    expect(parseDecimalEsCo(text, decimals)).toBe(expected);
  });

  it('con decimales permitidos, un punto seguido de 1 o 2 dígitos es decimal', () => {
    expect(parseDecimalEsCo('452.5', 2)).toBe('452.5');
    expect(parseDecimalEsCo('452.25', 2)).toBe('452.25');
    // Tres dígitos después del punto: separador de miles.
    expect(parseDecimalEsCo('1.250', 2)).toBe('1250');
  });

  it('en pesos (0 decimales) el punto es siempre separador de miles', () => {
    expect(parseDecimalEsCo('1.25', 0)).toBe('125');
    expect(parseDecimalEsCo('1.250', 0)).toBe('1250');
    expect(parseDecimalEsCo('1.250.000', 0)).toBe('1250000');
  });

  it.each([[''], ['   '], ['abc'], ['-5'], ['1,2,3'], ['1.25.0,5'], ['12,'], ['1,2.5'], ['4e5']])(
    '«%s» no es un número válido',
    (text) => {
      expect(parseDecimalEsCo(text, 2)).toBeNull();
    },
  );

  it('rechaza más decimales de los permitidos en lugar de redondear', () => {
    expect(parseDecimalEsCo('452,55', 1)).toBeNull();
    expect(parseDecimalEsCo('1.250,5', 0)).toBeNull();
    expect(parseDecimalEsCo('452.555', 2)).toBe('452555');
  });
});
