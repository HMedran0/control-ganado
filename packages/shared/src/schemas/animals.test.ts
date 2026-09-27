import { describe, expect, it } from 'vitest';

import { uuidv7 } from '../id.js';
import {
  bulkTagsSchema,
  createAnimalSchema,
  isDerivedTagKey,
  listAnimalsQuerySchema,
  updateAnimalSchema,
} from './animals.js';

const breedId = uuidv7();
const base = {
  code: ' 26-045 ',
  sex: 'FEMALE',
  breedId,
  birthDate: '2026-03-01',
  origin: 'BORN_ON_FARM',
} as const;

function fieldErrors(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('createAnimalSchema (ANI-01)', () => {
  it('recorta el código y vacía los textos en blanco', () => {
    const parsed = createAnimalSchema.parse({ ...base, name: '   ' });
    expect(parsed.code).toBe('26-045');
    expect(parsed.name).toBeNull();
  });

  it('un comprado exige fecha de ingreso', () => {
    const result = createAnimalSchema.safeParse({ ...base, origin: 'PURCHASED' });
    expect(fieldErrors(result)).toEqual(['entryDate']);
  });

  it('el valor de compra solo aplica a comprados', () => {
    const result = createAnimalSchema.safeParse({ ...base, purchasePrice: '1500000' });
    expect(fieldErrors(result)).toEqual(['purchasePrice']);
    expect(
      createAnimalSchema.safeParse({
        ...base,
        origin: 'PURCHASED',
        entryDate: '2026-04-01',
        purchasePrice: '1500000.50',
      }).success,
    ).toBe(true);
  });

  it('el valor de compra es texto decimal positivo, nunca un número', () => {
    for (const purchasePrice of ['0', '1.500.000', '12.345', 1500000, '-5']) {
      const result = createAnimalSchema.safeParse({
        ...base,
        origin: 'PURCHASED',
        entryDate: '2026-04-01',
        purchasePrice,
      });
      expect(result.success, String(purchasePrice)).toBe(false);
    }
  });

  it('padre interno o referencia externa, no ambos', () => {
    const result = createAnimalSchema.safeParse({
      ...base,
      sireId: uuidv7(),
      sireExternalRef: 'Pajilla 123',
    });
    expect(fieldErrors(result)).toEqual(['sireExternalRef']);
  });

  it('el peso inicial admite hasta dos decimales', () => {
    const conPeso = (weightKg: number) =>
      createAnimalSchema.safeParse({ ...base, initialWeight: { weightKg } }).success;
    expect(conPeso(32.5)).toBe(true);
    expect(conPeso(32.555)).toBe(false);
    expect(conPeso(0)).toBe(false);
  });
});

describe('updateAnimalSchema (ANI-02)', () => {
  it('exige la versión y al menos un cambio', () => {
    expect(updateAnimalSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateAnimalSchema.safeParse({ notes: 'x' }).success).toBe(false);
    expect(updateAnimalSchema.safeParse({ version: 1, notes: 'x' }).success).toBe(true);
  });
});

describe('listAnimalsQuerySchema (ANI-06)', () => {
  it('los valores separados por coma llegan como lista sin repetidos', () => {
    const parsed = listAnimalsQuerySchema.parse({
      tags: 'PREGNANT, CALVED,PREGNANT,',
      category: 'COW,HEIFER',
      alerts: 'calving_soon',
      forSale: 'true',
      ageMinMonths: '3',
    });
    expect(parsed.tags).toEqual(['PREGNANT', 'CALVED']);
    expect(parsed.category).toEqual(['COW', 'HEIFER']);
    expect(parsed.alerts).toEqual(['calving_soon']);
    expect(parsed.forSale).toBe(true);
    expect(parsed.ageMinMonths).toBe(3);
    expect(parsed.status).toBe('active');
    expect(parsed.sort).toBe('code');
  });

  it('rechaza valores fuera de las listas cerradas', () => {
    for (const query of [
      { category: 'VACA' },
      { alerts: 'todo' },
      { sort: 'name' },
      { status: 'deleted' },
      { tags: "COTERO'; DROP TABLE animals" },
      { ageMinMonths: '12', ageMaxMonths: '6' },
    ]) {
      expect(listAnimalsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('distingue etiquetas derivadas de las manuales', () => {
    expect(isDerivedTagKey('DRY')).toBe(true);
    expect(isDerivedTagKey('COTERO')).toBe(false);
  });
});

describe('bulkTagsSchema (CLS-02)', () => {
  const animalIds = [uuidv7()];

  it('exige algún cambio', () => {
    expect(bulkTagsSchema.safeParse({ animalIds }).success).toBe(false);
    expect(bulkTagsSchema.safeParse({ animalIds, forSale: false }).success).toBe(true);
  });

  it('no deja agregar y quitar la misma etiqueta', () => {
    const tag = uuidv7();
    expect(bulkTagsSchema.safeParse({ animalIds, add: [tag], remove: [tag] }).success).toBe(false);
  });

  it('quita los animales repetidos', () => {
    const id = uuidv7();
    expect(bulkTagsSchema.parse({ animalIds: [id, id], forSale: true }).animalIds).toEqual([id]);
  });
});
