import { describe, expect, it } from 'vitest';

import { toIsoDate } from '../date.js';
import { lotHasActiveAnimalsWarning } from '../errors.js';
import {
  catalogNameKey,
  createBreedSchema,
  createCycleSchema,
  createTagSchema,
  createVaccineSchema,
  farmSettingsFor,
  normalizeCatalogName,
  proposedGestationDays,
  rangesOverlap,
  tagKeyFromLabel,
  updateBreedSchema,
  updateFarmSchema,
  vaccineRuleErrors,
  type VaccineRules,
} from './catalogs.js';
import { DEFAULT_FARM_SETTINGS } from './farm-settings.js';

const d = toIsoDate;

describe('nombres de catálogo', () => {
  it('se normalizan: sin espacios al inicio, al final ni dobles', () => {
    expect(normalizeCatalogName('  Brahman   rojo ')).toBe('Brahman rojo');
  });

  it('«Brahman», «brahman » y «  BRAHMAN» son el mismo nombre', () => {
    const keys = ['Brahman', 'brahman ', '  BRAHMAN', 'Brahman'].map(catalogNameKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('el esquema guarda el nombre ya normalizado y rechaza uno vacío', () => {
    expect(createBreedSchema.parse({ name: '  Gyr   lechero ', group: 'INDICUS' }).name).toBe(
      'Gyr lechero',
    );
    const result = createBreedSchema.safeParse({ name: '   ', group: 'INDICUS' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Escribe el nombre de la raza.');
  });
});

describe('razas', () => {
  it.each([
    ['INDICUS', 293],
    ['TAURUS', 283],
    ['CROSS', 288],
  ] as const)('la gestación propuesta para %s es %i días (08 §1.4)', (group, days) => {
    expect(proposedGestationDays(group)).toBe(days);
  });

  it('un PATCH sin cambios no se acepta', () => {
    expect(updateBreedSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateBreedSchema.safeParse({ version: 1, gestationDays: null }).success).toBe(true);
  });
});

const BASE: VaccineRules = {
  scheduleType: 'NONE',
  boosterIntervalDays: null,
  eligibleSex: null,
  minAgeDays: null,
  maxAgeDays: null,
  blockIneligibleSex: false,
};

describe('coherencia de las vacunas (08 §1.5)', () => {
  it('brucelosis: ventana de edad en hembras, bloqueada en machos, es coherente', () => {
    expect(
      vaccineRuleErrors({
        ...BASE,
        scheduleType: 'AGE_WINDOW',
        eligibleSex: 'FEMALE',
        minAgeDays: 90,
        maxAgeDays: 270,
        blockIneligibleSex: true,
      }),
    ).toEqual({});
  });

  it.each([
    [
      'INTERVAL sin intervalo',
      { scheduleType: 'INTERVAL' },
      'boosterIntervalDays',
      'Indica cada cuántos días se repite la vacuna.',
    ],
    [
      'intervalo en una vacuna que no es por intervalo',
      { scheduleType: 'OFFICIAL_CYCLE', boosterIntervalDays: 365 },
      'boosterIntervalDays',
      'Solo las vacunas por intervalo llevan intervalo de refuerzo.',
    ],
    [
      'AGE_WINDOW sin edades',
      { scheduleType: 'AGE_WINDOW' },
      'minAgeDays',
      'Indica la edad mínima, la máxima o ambas.',
    ],
    [
      'edad mínima mayor que la máxima',
      { scheduleType: 'AGE_WINDOW', minAgeDays: 300, maxAgeDays: 90 },
      'maxAgeDays',
      'La edad máxima no puede ser menor que la mínima.',
    ],
    [
      'bloqueo sin sexo elegible',
      { blockIneligibleSex: true },
      'eligibleSex',
      'Para bloquear el otro sexo, indica a qué sexo se aplica la vacuna.',
    ],
  ] as const)('%s', (_caso, change, field, message) => {
    expect(vaccineRuleErrors({ ...BASE, ...change })).toEqual({ [field]: message });
  });

  it('el esquema de creación pone cada error en su campo', () => {
    const result = createVaccineSchema.safeParse({
      name: 'Triple',
      disease: 'Clostridiales',
      scheduleType: 'INTERVAL',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['boosterIntervalDays']);
  });

  it('dosis y vía vacías cuentan como «sin valor»', () => {
    const parsed = createVaccineSchema.parse({
      name: 'Aftosa',
      disease: 'Fiebre aftosa',
      scheduleType: 'OFFICIAL_CYCLE',
      defaultDose: '  ',
      route: ' Intramuscular ',
    });
    expect(parsed.defaultDose).toBeNull();
    expect(parsed.route).toBe('Intramuscular');
  });
});

describe('ciclos de vacunación', () => {
  const vaccineId = '0190a000-0000-7000-8000-000000000001';

  it('la fecha de fin no puede ser anterior a la de inicio', () => {
    const result = createCycleSchema.safeParse({
      name: '2026-2',
      startsOn: '2026-11-01',
      endsOn: '2026-10-31',
      vaccineIds: [vaccineId],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endsOn']);
  });

  it('un ciclo de un solo día es válido y las vacunas repetidas se unifican', () => {
    const parsed = createCycleSchema.parse({
      name: '2026-2',
      startsOn: '2026-11-01',
      endsOn: '2026-11-01',
      vaccineIds: [vaccineId, vaccineId],
    });
    expect(parsed.vaccineIds).toEqual([vaccineId]);
  });

  it('exige al menos una vacuna', () => {
    const result = createCycleSchema.safeParse({
      name: '2026-2',
      startsOn: '2026-11-01',
      endsOn: '2026-12-15',
      vaccineIds: [],
    });
    expect(result.error?.issues[0]?.message).toBe('Elige al menos una vacuna del ciclo.');
  });

  it.each([
    ['2026-05-04', '2026-06-23', true],
    ['2026-06-23', '2026-07-01', true],
    ['2026-06-24', '2026-07-01', false],
    ['2026-01-01', '2026-05-03', false],
  ])('%s a %s se cruza con 2026-1 (04/05–23/06): %s', (startsOn, endsOn, expected) => {
    const cycle = { startsOn: d('2026-05-04'), endsOn: d('2026-06-23') };
    expect(rangesOverlap(cycle, { startsOn: d(startsOn), endsOn: d(endsOn) })).toBe(expected);
  });
});

describe('etiquetas', () => {
  it.each([
    ['Disponible para venta', 'DISPONIBLE_PARA_VENTA'],
    ['  Cría   ñata ', 'CRIA_NATA'],
    ['Lote #3 (sabana)', 'LOTE_3_SABANA'],
    ['¡¡!!', 'ETIQUETA'],
  ])('«%s» → %s', (label, key) => {
    expect(tagKeyFromLabel(label)).toBe(key);
  });

  it('la descripción vacía se guarda como null', () => {
    expect(createTagSchema.parse({ label: 'Descarte', description: '' }).description).toBeNull();
  });
});

describe('finca', () => {
  it('los settings parciales NO se rellenan con los valores por defecto', () => {
    // Si se rellenaran, cambiar solo el destete pisaría el resto de la configuración.
    const parsed = updateFarmSchema.parse({ version: 3, settings: { weaningAgeMonths: 8 } });
    expect(parsed.settings).toEqual({ weaningAgeMonths: 8 });
  });

  it('rechaza parámetros fuera de rango y claves desconocidas', () => {
    expect(
      updateFarmSchema.safeParse({ version: 1, settings: { weaningAgeMonths: 0 } }).success,
    ).toBe(false);
    expect(updateFarmSchema.safeParse({ version: 1, settings: { destete: 7 } }).success).toBe(
      false,
    );
  });

  it('el precio por kilo solo lo ve ADMIN (RN-20)', () => {
    const settings = { ...DEFAULT_FARM_SETTINGS, pricePerKgByCategory: { COW: '9500.00' } };

    expect(farmSettingsFor('ADMIN', settings).pricePerKgByCategory).toEqual({ COW: '9500.00' });
    for (const role of ['OPERATOR', 'VET'] as const) {
      expect(farmSettingsFor(role, settings)).not.toHaveProperty('pricePerKgByCategory');
    }
  });
});

describe('advertencia de lote con animales activos', () => {
  it('concuerda en singular y plural', () => {
    expect(lotHasActiveAnimalsWarning(1).message).toBe('1 animal sigue en este lote.');
    expect(lotHasActiveAnimalsWarning(12).message).toBe('12 animales siguen en este lote.');
  });
});
