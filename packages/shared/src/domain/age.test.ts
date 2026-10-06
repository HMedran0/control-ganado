import { describe, expect, it } from 'vitest';

import { addDays, addMonths, toIsoDate } from '../date.js';
import { ICA_AGE_GROUP, SEX } from '../enums.js';
import {
  ageInDays,
  ageInMonths,
  ageInYears,
  icaAgeGroup,
  icaAgeGroupFor,
  monthsBetween,
  weaningBirthRange,
} from './age.js';

const d = toIsoDate;

describe('monthsBetween', () => {
  it('cuenta meses cumplidos', () => {
    expect(monthsBetween(d('2026-01-15'), d('2026-02-14'))).toBe(0);
    expect(monthsBetween(d('2026-01-15'), d('2026-02-15'))).toBe(1);
    expect(monthsBetween(d('2026-01-15'), d('2026-08-15'))).toBe(7);
    expect(monthsBetween(d('2026-01-15'), d('2027-01-15'))).toBe(12);
  });

  it('recorta a fin de mes (ADR-002)', () => {
    expect(monthsBetween(d('2026-01-31'), d('2026-02-28'))).toBe(1);
    expect(monthsBetween(d('2026-01-31'), d('2026-02-27'))).toBe(0);
    expect(monthsBetween(d('2026-01-30'), d('2026-02-28'))).toBe(1);
    expect(monthsBetween(d('2026-08-31'), d('2026-11-30'))).toBe(3);
  });

  it('el 29 de febrero cumple año el 28 en los años comunes', () => {
    expect(monthsBetween(d('2024-02-29'), d('2025-02-28'))).toBe(12);
    expect(monthsBetween(d('2024-02-29'), d('2025-02-27'))).toBe(11);
    expect(monthsBetween(d('2024-02-29'), d('2025-03-01'))).toBe(12);
    expect(monthsBetween(d('2024-02-29'), d('2028-02-29'))).toBe(48);
  });

  it('devuelve negativo si la segunda fecha es anterior', () => {
    expect(monthsBetween(d('2026-08-15'), d('2026-01-15'))).toBe(-7);
    expect(monthsBetween(d('2026-08-15'), d('2026-08-14'))).toBe(0);
    expect(monthsBetween(d('2026-08-15'), d('2026-07-16'))).toBe(0);
    expect(monthsBetween(d('2026-08-15'), d('2026-07-15'))).toBe(-1);
    expect(monthsBetween(d('2026-03-31'), d('2026-02-28'))).toBe(-1);
  });
});

describe('ageInDays y ageInYears', () => {
  it('cuenta días y años cumplidos', () => {
    expect(ageInDays(d('2026-09-01'), d('2026-09-26'))).toBe(25);
    expect(ageInYears(d('2020-09-26'), d('2026-09-26'))).toBe(6);
    expect(ageInYears(d('2020-09-27'), d('2026-09-26'))).toBe(5);
  });
});

describe('ageInMonths en los cortes del dominio', () => {
  const nacimiento = d('2026-01-15');

  it('corte de brucelosis a los 3 meses', () => {
    expect(ageInMonths(nacimiento, d('2026-04-14'))).toBe(2);
    expect(ageInMonths(nacimiento, d('2026-04-15'))).toBe(3);
  });

  it('corte de destete a los 7 meses', () => {
    expect(ageInMonths(nacimiento, d('2026-08-14'))).toBe(6);
    expect(ageInMonths(nacimiento, d('2026-08-15'))).toBe(7);
  });

  it('cortes de 9, 12 y 24 meses', () => {
    expect(ageInMonths(nacimiento, d('2026-10-14'))).toBe(8);
    expect(ageInMonths(nacimiento, d('2026-10-15'))).toBe(9);
    expect(ageInMonths(nacimiento, d('2027-01-14'))).toBe(11);
    expect(ageInMonths(nacimiento, d('2027-01-15'))).toBe(12);
    expect(ageInMonths(nacimiento, d('2028-01-14'))).toBe(23);
    expect(ageInMonths(nacimiento, d('2028-01-15'))).toBe(24);
  });

  it('propaga edad negativa si la fecha es anterior al nacimiento (RN-14 la valida la API)', () => {
    expect(ageInMonths(nacimiento, d('2025-12-15'))).toBe(-1);
  });
});

describe('icaAgeGroup (08 §2.2)', () => {
  it('agrupa las hembras en siete rangos', () => {
    expect(icaAgeGroup(SEX.FEMALE, 0)).toBe(ICA_AGE_GROUP.UNDER_3M);
    expect(icaAgeGroup(SEX.FEMALE, 2)).toBe(ICA_AGE_GROUP.UNDER_3M);
    expect(icaAgeGroup(SEX.FEMALE, 3)).toBe(ICA_AGE_GROUP.M3_TO_9);
    expect(icaAgeGroup(SEX.FEMALE, 8)).toBe(ICA_AGE_GROUP.M3_TO_9);
    expect(icaAgeGroup(SEX.FEMALE, 9)).toBe(ICA_AGE_GROUP.M9_TO_12);
    expect(icaAgeGroup(SEX.FEMALE, 11)).toBe(ICA_AGE_GROUP.M9_TO_12);
    expect(icaAgeGroup(SEX.FEMALE, 12)).toBe(ICA_AGE_GROUP.Y1_TO_2);
    expect(icaAgeGroup(SEX.FEMALE, 23)).toBe(ICA_AGE_GROUP.Y1_TO_2);
    expect(icaAgeGroup(SEX.FEMALE, 24)).toBe(ICA_AGE_GROUP.Y2_TO_3);
    expect(icaAgeGroup(SEX.FEMALE, 35)).toBe(ICA_AGE_GROUP.Y2_TO_3);
    expect(icaAgeGroup(SEX.FEMALE, 36)).toBe(ICA_AGE_GROUP.Y3_TO_5);
    expect(icaAgeGroup(SEX.FEMALE, 59)).toBe(ICA_AGE_GROUP.Y3_TO_5);
    expect(icaAgeGroup(SEX.FEMALE, 60)).toBe(ICA_AGE_GROUP.OVER_5Y);
    expect(icaAgeGroup(SEX.FEMALE, 200)).toBe(ICA_AGE_GROUP.OVER_5Y);
  });

  it('agrupa los machos en seis rangos, con > 3 años al final', () => {
    expect(icaAgeGroup(SEX.MALE, 2)).toBe(ICA_AGE_GROUP.UNDER_3M);
    expect(icaAgeGroup(SEX.MALE, 3)).toBe(ICA_AGE_GROUP.M3_TO_9);
    expect(icaAgeGroup(SEX.MALE, 9)).toBe(ICA_AGE_GROUP.M9_TO_12);
    expect(icaAgeGroup(SEX.MALE, 12)).toBe(ICA_AGE_GROUP.Y1_TO_2);
    expect(icaAgeGroup(SEX.MALE, 24)).toBe(ICA_AGE_GROUP.Y2_TO_3);
    expect(icaAgeGroup(SEX.MALE, 35)).toBe(ICA_AGE_GROUP.Y2_TO_3);
    expect(icaAgeGroup(SEX.MALE, 36)).toBe(ICA_AGE_GROUP.OVER_3Y);
    expect(icaAgeGroup(SEX.MALE, 120)).toBe(ICA_AGE_GROUP.OVER_3Y);
  });

  it('los machos nunca caen en los grupos exclusivos de hembras', () => {
    const gruposDeMachos = [0, 3, 9, 12, 24, 36, 60, 120].map((m) => icaAgeGroup(SEX.MALE, m));
    expect(gruposDeMachos).not.toContain(ICA_AGE_GROUP.Y3_TO_5);
    expect(gruposDeMachos).not.toContain(ICA_AGE_GROUP.OVER_5Y);
  });

  it('icaAgeGroupFor calcula desde la fecha de nacimiento', () => {
    expect(icaAgeGroupFor(SEX.FEMALE, d('2026-01-15'), d('2026-04-15'))).toBe(
      ICA_AGE_GROUP.M3_TO_9,
    );
    expect(icaAgeGroupFor(SEX.MALE, d('2020-01-15'), d('2026-09-26'))).toBe(ICA_AGE_GROUP.OVER_3Y);
  });
});

describe('weaningBirthRange (destete del mes, M8a)', () => {
  it('los que se destetan en septiembre a los 7 meses nacieron en febrero', () => {
    expect(weaningBirthRange(toIsoDate('2026-09-25'), 7)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('cruza el año y respeta el 29 de febrero', () => {
    expect(weaningBirthRange(toIsoDate('2025-01-10'), 7)).toEqual({
      from: '2024-06-01',
      to: '2024-06-30',
    });
    expect(weaningBirthRange(toIsoDate('2028-09-01'), 7)).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('coincide con monthsBetween: cada nacido del rango cumple la edad dentro del mes, y nadie más', () => {
    for (const [month, weaning] of [
      ['2026-02', 1],
      ['2026-09', 7],
      ['2026-03', 1],
    ] as const) {
      const start = toIsoDate(month + '-01');
      const range = weaningBirthRange(start, weaning);
      const end = addDays(addMonths(start, 1), -1);
      for (let day = addMonths(start, -weaning - 1); day <= end; day = addDays(day, 1)) {
        // El primer día en que cumple los meses de destete.
        let reachedOn = day;
        while (monthsBetween(day, reachedOn) < weaning) reachedOn = addDays(reachedOn, 1);
        const weansInMonth = reachedOn >= start && reachedOn <= end;
        const inRange = day >= range.from && day <= range.to;
        expect(inRange, month + ' ' + day).toBe(weansInMonth);
      }
    }
  });
});
