import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { BREED_GROUP } from '../enums.js';
import { DomainError } from '../errors.js';
import {
  DEFAULT_FARM_GESTATION_DAYS,
  DEFAULT_GESTATION_DAYS_BY_GROUP,
  defaultGestationDaysForGroup,
  expectedCalvingDate,
  gestationDaysFor,
} from './pregnancy.js';

const d = toIsoDate;
const FINCA = DEFAULT_FARM_GESTATION_DAYS;

describe('gestación por grupo racial (08 §1.4)', () => {
  it('cebuinos 293, taurinos 283, cruces 288', () => {
    expect(DEFAULT_GESTATION_DAYS_BY_GROUP.INDICUS).toBe(293);
    expect(DEFAULT_GESTATION_DAYS_BY_GROUP.TAURUS).toBe(283);
    expect(DEFAULT_GESTATION_DAYS_BY_GROUP.CROSS).toBe(288);
    expect(defaultGestationDaysForGroup(BREED_GROUP.INDICUS)).toBe(293);
  });

  it('la finca de referencia usa 285 días', () => {
    expect(FINCA).toBe(285);
  });
});

describe('gestationDaysFor (RN-04)', () => {
  it('usa los días de la raza de la madre cuando los tiene', () => {
    expect(gestationDaysFor({ breedGestationDays: 293, farmGestationDays: FINCA })).toBe(293);
    expect(gestationDaysFor({ breedGestationDays: 283, farmGestationDays: FINCA })).toBe(283);
    expect(gestationDaysFor({ breedGestationDays: 288, farmGestationDays: FINCA })).toBe(288);
  });

  it('cae en los días de la finca si la raza no tiene valor', () => {
    expect(gestationDaysFor({ breedGestationDays: null, farmGestationDays: FINCA })).toBe(285);
    expect(gestationDaysFor({ breedGestationDays: null, farmGestationDays: 290 })).toBe(290);
  });

  it('rechaza valores que no son enteros positivos', () => {
    expect(() =>
      gestationDaysFor({ breedGestationDays: 0, farmGestationDays: FINCA }),
    ).toThrowError(DomainError);
    expect(() =>
      gestationDaysFor({ breedGestationDays: -5, farmGestationDays: FINCA }),
    ).toThrowError(DomainError);
    expect(() =>
      gestationDaysFor({ breedGestationDays: 283.5, farmGestationDays: FINCA }),
    ).toThrowError(DomainError);
    expect(() =>
      gestationDaysFor({ breedGestationDays: null, farmGestationDays: Number.NaN }),
    ).toThrowError(DomainError);
  });
});

describe('expectedCalvingDate (RN-04)', () => {
  const serviceDate = d('2026-03-15');

  it('suma la gestación de la raza de la madre', () => {
    expect(
      expectedCalvingDate({ serviceDate, breedGestationDays: 293, farmGestationDays: FINCA }),
    ).toBe('2027-01-02');
    expect(
      expectedCalvingDate({ serviceDate, breedGestationDays: 283, farmGestationDays: FINCA }),
    ).toBe('2026-12-23');
    expect(
      expectedCalvingDate({ serviceDate, breedGestationDays: 288, farmGestationDays: FINCA }),
    ).toBe('2026-12-28');
  });

  it('con raza sin valor usa los 285 días de la finca', () => {
    expect(
      expectedCalvingDate({ serviceDate, breedGestationDays: null, farmGestationDays: FINCA }),
    ).toBe('2026-12-25');
  });

  it('cuenta el 29 de febrero cuando la gestación cruza un año bisiesto', () => {
    // De marzo de 2023 a 2024: el rango incluye el 29 de febrero de 2024.
    expect(
      expectedCalvingDate({
        serviceDate: d('2023-05-20'),
        breedGestationDays: 293,
        farmGestationDays: FINCA,
      }),
    ).toBe('2024-03-08');
  });

  it('cruza fin de mes y fin de año sin desviarse', () => {
    expect(
      expectedCalvingDate({
        serviceDate: d('2026-01-31'),
        breedGestationDays: 293,
        farmGestationDays: FINCA,
      }),
    ).toBe('2026-11-20');
    expect(
      expectedCalvingDate({
        serviceDate: d('2026-12-31'),
        breedGestationDays: 283,
        farmGestationDays: FINCA,
      }),
    ).toBe('2027-10-10');
  });

  it('el mismo servicio da fechas distintas según la raza', () => {
    const cebuino = expectedCalvingDate({
      serviceDate,
      breedGestationDays: 293,
      farmGestationDays: FINCA,
    });
    const taurino = expectedCalvingDate({
      serviceDate,
      breedGestationDays: 283,
      farmGestationDays: FINCA,
    });
    expect(cebuino > taurino).toBe(true);
  });
});
