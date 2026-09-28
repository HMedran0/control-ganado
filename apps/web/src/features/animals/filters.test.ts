import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  apiQuery,
  filterChips,
  filtersFromSearch,
  hasFilters,
  searchFromFilters,
  validateAnimalListSearch,
  type CatalogNames,
} from './filters';

const LOT = '0199a1b2-0000-7000-8000-000000000001';
const NAMES: CatalogNames = {
  lots: new Map([[LOT, 'Paridas']]),
  breeds: new Map(),
  tags: new Map([['COTERO', 'Cotero']]),
};

describe('filtros del listado ↔ URL (ANI-06 CA1)', () => {
  it('sin parámetros, el listado por defecto: activos por código', () => {
    expect(filtersFromSearch({})).toEqual(DEFAULT_FILTERS);
    expect(searchFromFilters(DEFAULT_FILTERS)).toEqual({});
    expect(hasFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it('ida y vuelta: lo que se pone en la URL vuelve igual al recargar', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      sex: 'FEMALE' as const,
      tags: ['PREGNANT', 'COTERO'],
      category: ['COW' as const],
      lotId: [LOT],
      ageMin: 12,
      ageMax: 36,
      forSale: true,
      status: 'exited' as const,
      sort: '-lastWeight' as const,
    };
    const search = searchFromFilters(filters);
    expect(search).toEqual({
      sex: 'FEMALE',
      tags: 'PREGNANT,COTERO',
      category: 'COW',
      lotId: LOT,
      ageMin: 12,
      ageMax: 36,
      forSale: true,
      status: 'exited',
      sort: '-lastWeight',
    });
    expect(filtersFromSearch(search)).toEqual(filters);
  });

  it('lo que no se entiende se descarta sin romper la pantalla', () => {
    expect(
      validateAnimalListSearch({
        sex: 'hembra',
        tags: "PREGNANT,x'; drop,,PREGNANT",
        category: 'VACA,COW',
        lotId: 'no-es-uuid',
        alerts: 'todo,calving_soon',
        ageMin: -3,
        ageMax: 'muchos',
        status: 'archived',
        sort: 'name',
        forSale: 'quizás',
      }),
    ).toEqual({ tags: 'PREGNANT', category: 'COW', alerts: 'calving_soon' });
  });

  it('una edad mínima mayor que la máxima se invierte en lugar de dar un listado vacío', () => {
    const filters = filtersFromSearch({ ageMin: 24, ageMax: 6 });
    expect([filters.ageMin, filters.ageMax]).toEqual([6, 24]);
  });

  it('la consulta a la API usa los nombres del contrato y sale ordenada', () => {
    expect(
      apiQuery({ ...DEFAULT_FILTERS, tags: ['PREGNANT', 'CALVED'], ageMin: 3, sex: 'FEMALE' }),
    ).toBe('ageMinMonths=3&sex=FEMALE&sort=code&status=active&tags=PREGNANT%2CCALVED');
  });

  it('un chip por filtro, y al quitarlo quedan los demás', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      sex: 'FEMALE' as const,
      tags: ['PREGNANT', 'COTERO'],
      lotId: [LOT],
    };
    const chips = filterChips(filters, NAMES);
    expect(chips.map((chip) => chip.label)).toEqual([
      'Hembras',
      'Preñadas',
      'Cotero',
      'Lote Paridas',
    ]);

    const withoutPregnant = chips.find((chip) => chip.label === 'Preñadas')?.without;
    expect(withoutPregnant?.tags).toEqual(['COTERO']);
    expect(withoutPregnant?.sex).toBe('FEMALE');
  });

  it('el orden no cuenta como filtro', () => {
    expect(hasFilters({ ...DEFAULT_FILTERS, sort: 'age' })).toBe(false);
    expect(hasFilters({ ...DEFAULT_FILTERS, forSale: true })).toBe(true);
  });
});
