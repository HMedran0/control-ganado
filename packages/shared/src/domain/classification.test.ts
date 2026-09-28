import { describe, expect, it } from 'vitest';

import { toIsoDate, type IsoDate } from '../date.js';
import { DERIVED_TAG, MANAGEMENT_CATEGORY, SEX, type Sex } from '../enums.js';
import {
  derivedTags,
  managementCategory,
  summarizePregnancies,
  type DerivedTagsInput,
} from './classification.js';

const d = toIsoDate;
const HOY = d('2026-09-25');
const DESTETE = 7;

/** Fecha de nacimiento para que el animal tenga exactamente esa edad en meses hoy. */
function nacidoHaceMeses(months: number): IsoDate {
  const year = 2026 - Math.floor(months / 12);
  const monthIndex = 9 - (months % 12);
  const adjustedYear = monthIndex <= 0 ? year - 1 : year;
  const adjustedMonth = monthIndex <= 0 ? monthIndex + 12 : monthIndex;
  return d(`${adjustedYear}-${String(adjustedMonth).padStart(2, '0')}-25`);
}

function categoria(sex: Sex, months: number, calvingCount = 0) {
  return managementCategory({
    sex,
    birthDate: nacidoHaceMeses(months),
    calvingCount,
    weaningAgeMonths: DESTETE,
    today: HOY,
  });
}

describe('managementCategory (RN-06)', () => {
  it('cría por edad, según el sexo', () => {
    expect(categoria(SEX.FEMALE, 0)).toBe(MANAGEMENT_CATEGORY.CALF_FEMALE);
    expect(categoria(SEX.FEMALE, 6)).toBe(MANAGEMENT_CATEGORY.CALF_FEMALE);
    expect(categoria(SEX.MALE, 6)).toBe(MANAGEMENT_CATEGORY.CALF_MALE);
  });

  it('el día en que cumple el destete deja de ser cría', () => {
    expect(categoria(SEX.FEMALE, 7)).toBe(MANAGEMENT_CATEGORY.HEIFER);
    expect(categoria(SEX.MALE, 7)).toBe(MANAGEMENT_CATEGORY.YOUNG_MALE);
  });

  it('hembra destetada sin partos es novilla; con partos, vaca', () => {
    expect(categoria(SEX.FEMALE, 20, 0)).toBe(MANAGEMENT_CATEGORY.HEIFER);
    expect(categoria(SEX.FEMALE, 36, 0)).toBe(MANAGEMENT_CATEGORY.HEIFER);
    expect(categoria(SEX.FEMALE, 36, 1)).toBe(MANAGEMENT_CATEGORY.COW);
    expect(categoria(SEX.FEMALE, 96, 5)).toBe(MANAGEMENT_CATEGORY.COW);
  });

  it('una cría con parto registrado sigue siendo cría: la edad manda (RN-06)', () => {
    expect(categoria(SEX.FEMALE, 6, 1)).toBe(MANAGEMENT_CATEGORY.CALF_FEMALE);
  });

  it('macho: levante hasta los 24 meses, adulto desde ahí', () => {
    expect(categoria(SEX.MALE, 23)).toBe(MANAGEMENT_CATEGORY.YOUNG_MALE);
    expect(categoria(SEX.MALE, 24)).toBe(MANAGEMENT_CATEGORY.ADULT_MALE);
    expect(categoria(SEX.MALE, 60)).toBe(MANAGEMENT_CATEGORY.ADULT_MALE);
  });

  it('respeta una edad de destete distinta a la de la finca de referencia', () => {
    const conDestete9 = managementCategory({
      sex: SEX.FEMALE,
      birthDate: nacidoHaceMeses(8),
      calvingCount: 0,
      weaningAgeMonths: 9,
      today: HOY,
    });
    expect(conDestete9).toBe(MANAGEMENT_CATEGORY.CALF_FEMALE);
  });
});

function etiquetas(overrides: Partial<DerivedTagsInput> = {}) {
  return derivedTags({
    category: MANAGEMENT_CATEGORY.COW,
    hasOpenConfirmedPregnancy: false,
    hasOpenUnconfirmedPregnancy: false,
    calvingCount: 1,
    lastCalvingDate: d('2026-01-25'),
    withdrawalUntil: null,
    weaningAgeMonths: DESTETE,
    today: HOY,
    ...overrides,
  });
}

describe('derivedTags', () => {
  it('SERVED con preñez abierta sin confirmar (RN-08)', () => {
    expect(etiquetas({ hasOpenUnconfirmedPregnancy: true })).toContain(DERIVED_TAG.SERVED);
    expect(etiquetas({ hasOpenUnconfirmedPregnancy: true })).not.toContain(DERIVED_TAG.PREGNANT);
  });

  it('PREGNANT con preñez abierta confirmada (RN-08)', () => {
    expect(etiquetas({ hasOpenConfirmedPregnancy: true })).toContain(DERIVED_TAG.PREGNANT);
  });

  it('CALVED con al menos un parto (RN-07)', () => {
    expect(etiquetas({ calvingCount: 1 })).toContain(DERIVED_TAG.CALVED);
    expect(etiquetas({ calvingCount: 4 })).toContain(DERIVED_TAG.CALVED);
    expect(
      etiquetas({
        calvingCount: 0,
        category: MANAGEMENT_CATEGORY.HEIFER,
        lastCalvingDate: null,
      }),
    ).not.toContain(DERIVED_TAG.CALVED);
  });

  describe('DRY, «horra» (RN-25)', () => {
    it('vaca sin preñez cuyo último parto fue hace 8 meses', () => {
      expect(etiquetas({ lastCalvingDate: d('2026-01-25') })).toContain(DERIVED_TAG.DRY);
    });

    it('el día en que el último parto cumple la edad de destete', () => {
      expect(etiquetas({ lastCalvingDate: d('2026-02-25') })).toContain(DERIVED_TAG.DRY);
      expect(etiquetas({ lastCalvingDate: d('2026-02-26') })).not.toContain(DERIVED_TAG.DRY);
    });

    it('no es horra si tiene cría al pie: parto hace 6 meses', () => {
      expect(etiquetas({ lastCalvingDate: d('2026-03-25') })).not.toContain(DERIVED_TAG.DRY);
    });

    it('no es horra si está servida o preñada', () => {
      expect(etiquetas({ hasOpenUnconfirmedPregnancy: true })).not.toContain(DERIVED_TAG.DRY);
      expect(etiquetas({ hasOpenConfirmedPregnancy: true })).not.toContain(DERIVED_TAG.DRY);
    });

    it('solo las vacas son horras, no las novillas', () => {
      expect(
        etiquetas({ category: MANAGEMENT_CATEGORY.HEIFER, calvingCount: 0, lastCalvingDate: null }),
      ).not.toContain(DERIVED_TAG.DRY);
    });

    it('sin fecha de último parto no se marca horra', () => {
      expect(etiquetas({ lastCalvingDate: null })).not.toContain(DERIVED_TAG.DRY);
    });
  });

  describe('WITHDRAWAL, «en retiro»', () => {
    it('está en retiro el último día', () => {
      expect(etiquetas({ withdrawalUntil: HOY })).toContain(DERIVED_TAG.WITHDRAWAL);
    });

    it('ya no está en retiro el día siguiente', () => {
      expect(etiquetas({ withdrawalUntil: d('2026-09-24') })).not.toContain(DERIVED_TAG.WITHDRAWAL);
    });

    it('sigue en retiro si la fecha es futura', () => {
      expect(etiquetas({ withdrawalUntil: d('2026-10-05') })).toContain(DERIVED_TAG.WITHDRAWAL);
    });
  });

  it('las etiquetas salen en orden fijo y se combinan', () => {
    expect(
      etiquetas({
        hasOpenConfirmedPregnancy: true,
        calvingCount: 3,
        withdrawalUntil: d('2026-10-05'),
      }),
    ).toEqual([DERIVED_TAG.PREGNANT, DERIVED_TAG.CALVED, DERIVED_TAG.WITHDRAWAL]);
  });

  it('una novilla sin nada devuelve lista vacía', () => {
    expect(
      etiquetas({
        category: MANAGEMENT_CATEGORY.HEIFER,
        calvingCount: 0,
        lastCalvingDate: null,
      }),
    ).toEqual([]);
  });
});

describe('summarizePregnancies', () => {
  const pregnancy = (
    outcome: 'PENDING' | 'CALVED' | 'ABORTED' | 'FAILED',
    service: string,
    extra: Partial<{ outcomeDate: string; confirmedAt: string; voided: boolean }> = {},
  ) => ({
    outcome,
    serviceDate: d(service),
    outcomeDate: extra.outcomeDate === undefined ? null : d(extra.outcomeDate),
    confirmedAt: extra.confirmedAt === undefined ? null : d(extra.confirmedAt),
    expectedCalvingDate: d('2027-01-01'),
    voided: extra.voided ?? false,
  });

  it('sin preñeces', () => {
    expect(summarizePregnancies([])).toEqual({
      calvingCount: 0,
      lastCalvingDate: null,
      openPregnancy: null,
    });
  });

  it('cuenta partos no anulados y toma el más reciente', () => {
    const facts = summarizePregnancies([
      pregnancy('CALVED', '2023-01-01', { outcomeDate: '2023-10-10' }),
      pregnancy('CALVED', '2024-02-01', { outcomeDate: '2024-11-12' }),
      pregnancy('CALVED', '2025-02-01', { outcomeDate: '2025-11-12', voided: true }),
      pregnancy('ABORTED', '2025-03-01', { outcomeDate: '2025-06-01' }),
    ]);
    expect(facts.calvingCount).toBe(2);
    expect(facts.lastCalvingDate).toBe('2024-11-12');
    expect(facts.openPregnancy).toBeNull();
  });

  it('suma los partos anteriores importados sin tocar la fecha del último (RN-29)', () => {
    expect(summarizePregnancies([], 3)).toEqual({
      calvingCount: 3,
      lastCalvingDate: null,
      openPregnancy: null,
    });
    const facts = summarizePregnancies(
      [pregnancy('CALVED', '2025-01-01', { outcomeDate: '2025-10-10' })],
      3,
    );
    expect(facts.calvingCount).toBe(4);
    expect(facts.lastCalvingDate).toBe('2025-10-10');
  });

  it('la preñez abierta no anulada, confirmada o no', () => {
    const facts = summarizePregnancies([
      pregnancy('PENDING', '2026-01-01', { voided: true }),
      pregnancy('PENDING', '2026-03-01', { confirmedAt: '2026-05-01' }),
    ]);
    expect(facts.openPregnancy).toEqual({
      serviceDate: '2026-03-01',
      confirmedAt: '2026-05-01',
      expectedCalvingDate: '2027-01-01',
    });
  });

  it('si hubiera dos abiertas por error de datos, cuenta la de servicio más reciente', () => {
    const facts = summarizePregnancies([
      pregnancy('PENDING', '2026-05-01'),
      pregnancy('PENDING', '2026-02-01', { confirmedAt: '2026-04-01' }),
    ]);
    expect(facts.openPregnancy?.serviceDate).toBe('2026-05-01');
  });
});
