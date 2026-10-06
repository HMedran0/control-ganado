import {
  ANIMAL_ALERT,
  ANIMAL_SORT,
  DERIVED_TAG,
  MANAGEMENT_CATEGORY,
  SALE_WEIGHT_STATUS,
  formatDate,
  isDerivedTagKey,
  isIsoDate,
  isUuid,
  type AnimalAlert,
  type AnimalSort,
  type IsoDate,
  type ManagementCategory,
  type SaleWeightStatus,
  type Sex,
} from '@hato/shared';

import {
  ALERT_LABEL,
  CATEGORY_FILTER_LABEL,
  DERIVED_TAG_FILTER_LABEL,
  SEX_FILTER_LABEL,
} from './labels';

/**
 * Filtros del listado de animales ↔ URL (ANI-06 CA1: los filtros se comparten y se vuelven a
 * abrir) ↔ consulta de la API.
 *
 * En la URL las listas van separadas por coma (`?tags=PREGNANT,CALVED`), los números como
 * números y el booleano como booleano: así TanStack Router no los envuelve en comillas. Lo que
 * no se entiende se descarta en silencio: un enlace viejo o mal copiado abre el listado con los
 * filtros válidos, no una pantalla de error.
 */

export type AnimalListStatusFilter = 'active' | 'exited';

/** Filtros ya interpretados, como los usa la pantalla. */
export type AnimalListFilters = {
  readonly sex: Sex | null;
  readonly category: readonly ManagementCategory[];
  /** Etiquetas derivadas (`PREGNANT`) y claves de etiquetas manuales (`COTERO`). */
  readonly tags: readonly string[];
  readonly lotId: readonly string[];
  readonly breedId: readonly string[];
  readonly alerts: readonly AnimalAlert[];
  readonly ageMin: number | null;
  readonly ageMax: number | null;
  readonly forSale: boolean | null;
  /** Nacidos entre estas fechas (M8a: destete del mes, enlazado desde Inicio). */
  readonly bornFrom: IsoDate | null;
  readonly bornTo: IsoDate | null;
  /** Situación frente al peso de venta (PES-06, M8a). */
  readonly saleWeight: SaleWeightStatus | null;
  /** Con retiro de leche vigente (M8a). */
  readonly milkWithdrawal: boolean | null;
  readonly status: AnimalListStatusFilter;
  readonly sort: AnimalSort;
};

/** Parámetros de la URL de `/animals`. Todos opcionales: sin ellos, el listado por defecto. */
export type AnimalListSearch = {
  readonly sex?: Sex;
  readonly category?: string;
  readonly tags?: string;
  readonly lotId?: string;
  readonly breedId?: string;
  readonly alerts?: string;
  readonly ageMin?: number;
  readonly ageMax?: number;
  readonly forSale?: boolean;
  readonly bornFrom?: string;
  readonly bornTo?: string;
  readonly saleWeight?: SaleWeightStatus;
  readonly milkWithdrawal?: boolean;
  readonly status?: 'exited';
  readonly sort?: AnimalSort;
};

export const DEFAULT_FILTERS: AnimalListFilters = {
  sex: null,
  category: [],
  tags: [],
  lotId: [],
  breedId: [],
  alerts: [],
  ageMin: null,
  ageMax: null,
  forSale: null,
  bornFrom: null,
  bornTo: null,
  saleWeight: null,
  milkWithdrawal: null,
  status: 'active',
  sort: 'code',
};

const CATEGORIES = new Set<string>(Object.values(MANAGEMENT_CATEGORY));
const ALERTS = new Set<string>(Object.values(ANIMAL_ALERT));
const SORTS = new Set<string>(ANIMAL_SORT);
const SALE_WEIGHT = new Set<string>(Object.values(SALE_WEIGHT_STATUS));

/** Etiqueta del filtro de peso de venta (PES-06): lo medido y lo estimado, con palabras distintas. */
export const SALE_WEIGHT_FILTER_LABEL: Readonly<Record<SaleWeightStatus, string>> = {
  [SALE_WEIGHT_STATUS.REACHED]: 'Ya en el peso de venta',
  [SALE_WEIGHT_STATUS.THIS_MONTH]: 'Alcanzan el peso este mes',
  [SALE_WEIGHT_STATUS.LIKELY_REACHED]: 'Posiblemente en el peso (estimado)',
  [SALE_WEIGHT_STATUS.LATER]: 'Alcanzan el peso después de este mes',
};

function isoDate(value: unknown): IsoDate | null {
  return typeof value === 'string' && isIsoDate(value) ? value : null;
}
const TAG_KEY = /^[A-Z0-9_]{1,60}$/;

function list(value: unknown, accept: (item: string) => boolean): string[] {
  if (typeof value !== 'string') return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '' && accept(item)),
    ),
  ];
}

function months(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= 600
    ? number
    : null;
}

function csv(items: readonly string[]): string | undefined {
  return items.length === 0 ? undefined : items.join(',');
}

/** De la URL a los filtros. Nunca falla: lo inválido se ignora. */
export function filtersFromSearch(search: Record<string, unknown>): AnimalListFilters {
  let ageMin = months(search.ageMin);
  let ageMax = months(search.ageMax);
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  const forSale = search.forSale === true || search.forSale === 'true' ? true : null;
  let bornFrom = isoDate(search.bornFrom);
  let bornTo = isoDate(search.bornTo);
  if (bornFrom !== null && bornTo !== null && bornFrom > bornTo)
    [bornFrom, bornTo] = [bornTo, bornFrom];

  return {
    sex: search.sex === 'FEMALE' || search.sex === 'MALE' ? search.sex : null,
    category: list(search.category, (item) => CATEGORIES.has(item)) as ManagementCategory[],
    tags: list(search.tags, (item) => TAG_KEY.test(item)),
    lotId: list(search.lotId, isUuid),
    breedId: list(search.breedId, isUuid),
    alerts: list(search.alerts, (item) => ALERTS.has(item)) as AnimalAlert[],
    ageMin,
    ageMax,
    forSale,
    bornFrom,
    bornTo,
    saleWeight:
      typeof search.saleWeight === 'string' && SALE_WEIGHT.has(search.saleWeight)
        ? (search.saleWeight as SaleWeightStatus)
        : null,
    milkWithdrawal:
      search.milkWithdrawal === true || search.milkWithdrawal === 'true' ? true : null,
    status: search.status === 'exited' ? 'exited' : 'active',
    sort:
      typeof search.sort === 'string' && SORTS.has(search.sort)
        ? (search.sort as AnimalSort)
        : 'code',
  };
}

/** De los filtros a la URL, sin los valores por defecto (la URL queda corta y legible). */
export function searchFromFilters(filters: AnimalListFilters): AnimalListSearch {
  const search: Record<string, unknown> = {
    sex: filters.sex ?? undefined,
    category: csv(filters.category),
    tags: csv(filters.tags),
    lotId: csv(filters.lotId),
    breedId: csv(filters.breedId),
    alerts: csv(filters.alerts),
    ageMin: filters.ageMin ?? undefined,
    ageMax: filters.ageMax ?? undefined,
    forSale: filters.forSale === true ? true : undefined,
    bornFrom: filters.bornFrom ?? undefined,
    bornTo: filters.bornTo ?? undefined,
    saleWeight: filters.saleWeight ?? undefined,
    milkWithdrawal: filters.milkWithdrawal === true ? true : undefined,
    status: filters.status === 'exited' ? 'exited' : undefined,
    sort: filters.sort === 'code' ? undefined : filters.sort,
  };
  return Object.fromEntries(Object.entries(search).filter(([, value]) => value !== undefined));
}

/** `validateSearch` de la ruta: limpia la URL y deja solo lo que se entiende. */
export function validateAnimalListSearch(search: Record<string, unknown>): AnimalListSearch {
  return searchFromFilters(filtersFromSearch(search));
}

/** Consulta de `GET /animals` (sin paginación), con las claves ordenadas para la caché. */
export function apiQuery(filters: AnimalListFilters): string {
  const params = new URLSearchParams();
  const add = (key: string, value: string | undefined): void => {
    if (value !== undefined) params.set(key, value);
  };
  add('sex', filters.sex ?? undefined);
  add('category', csv(filters.category));
  add('tags', csv(filters.tags));
  add('lotId', csv(filters.lotId));
  add('breedId', csv(filters.breedId));
  add('alerts', csv(filters.alerts));
  add('ageMinMonths', filters.ageMin === null ? undefined : String(filters.ageMin));
  add('ageMaxMonths', filters.ageMax === null ? undefined : String(filters.ageMax));
  add('forSale', filters.forSale === true ? 'true' : undefined);
  add('bornFrom', filters.bornFrom ?? undefined);
  add('bornTo', filters.bornTo ?? undefined);
  add('saleWeight', filters.saleWeight ?? undefined);
  add('milkWithdrawal', filters.milkWithdrawal === true ? 'true' : undefined);
  add('status', filters.status);
  add('sort', filters.sort);
  params.sort();
  return params.toString();
}

/** ¿Hay algún filtro puesto? (El orden no cuenta como filtro.) */
export function hasFilters(filters: AnimalListFilters): boolean {
  return apiQuery({ ...filters, sort: 'code' }) !== apiQuery({ ...DEFAULT_FILTERS });
}

/** Nombres de los catálogos para los chips (lotes, razas y etiquetas manuales). */
export type CatalogNames = {
  readonly lots: ReadonlyMap<string, string>;
  readonly breeds: ReadonlyMap<string, string>;
  /** Por clave: `COTERO` → «Cotero». */
  readonly tags: ReadonlyMap<string, string>;
};

export type FilterChip = {
  readonly id: string;
  readonly label: string;
  /** Los filtros sin este chip. */
  readonly without: AnimalListFilters;
};

/** Un chip por filtro puesto, con lo que queda al quitarlo (06 §5.2: «[Preñadas ✕]»). */
export function filterChips(filters: AnimalListFilters, names: CatalogNames): FilterChip[] {
  const chips: FilterChip[] = [];
  const drop = <K extends keyof AnimalListFilters>(key: K, item: string) => ({
    ...filters,
    [key]: (filters[key] as readonly string[]).filter((value) => value !== item),
  });

  if (filters.status === 'exited') {
    chips.push({
      id: 'status',
      label: 'Vendidos o retirados',
      without: { ...filters, status: 'active' },
    });
  }
  if (filters.sex !== null) {
    chips.push({
      id: 'sex',
      label: SEX_FILTER_LABEL[filters.sex],
      without: { ...filters, sex: null },
    });
  }
  for (const category of filters.category) {
    chips.push({
      id: `category:${category}`,
      label: CATEGORY_FILTER_LABEL[category],
      without: drop('category', category),
    });
  }
  for (const tag of filters.tags) {
    chips.push({
      id: `tag:${tag}`,
      label: isDerivedTagKey(tag)
        ? DERIVED_TAG_FILTER_LABEL[tag]
        : (names.tags.get(tag) ?? tag.charAt(0) + tag.slice(1).toLowerCase()),
      without: drop('tags', tag),
    });
  }
  for (const alert of filters.alerts) {
    chips.push({ id: `alert:${alert}`, label: ALERT_LABEL[alert], without: drop('alerts', alert) });
  }
  for (const lot of filters.lotId) {
    chips.push({
      id: `lot:${lot}`,
      label: `Lote ${names.lots.get(lot) ?? '(sin nombre)'}`,
      without: drop('lotId', lot),
    });
  }
  for (const breed of filters.breedId) {
    chips.push({
      id: `breed:${breed}`,
      label: names.breeds.get(breed) ?? 'Raza',
      without: drop('breedId', breed),
    });
  }
  if (filters.ageMin !== null || filters.ageMax !== null) {
    chips.push({
      id: 'age',
      label: ageLabel(filters.ageMin, filters.ageMax),
      without: { ...filters, ageMin: null, ageMax: null },
    });
  }
  if (filters.forSale === true) {
    chips.push({
      id: 'forSale',
      label: 'Disponibles para venta',
      without: { ...filters, forSale: null },
    });
  }
  if (filters.bornFrom !== null || filters.bornTo !== null) {
    chips.push({
      id: 'born',
      label: bornLabel(filters.bornFrom, filters.bornTo),
      without: { ...filters, bornFrom: null, bornTo: null },
    });
  }
  if (filters.saleWeight !== null) {
    chips.push({
      id: 'saleWeight',
      label: SALE_WEIGHT_FILTER_LABEL[filters.saleWeight],
      without: { ...filters, saleWeight: null },
    });
  }
  if (filters.milkWithdrawal === true) {
    chips.push({
      id: 'milkWithdrawal',
      label: 'En retiro de leche',
      without: { ...filters, milkWithdrawal: null },
    });
  }
  return chips;
}

function bornLabel(from: IsoDate | null, to: IsoDate | null): string {
  if (from !== null && to !== null) return `Nacidos del ${formatDate(from)} al ${formatDate(to)}`;
  if (from !== null) return `Nacidos desde el ${formatDate(from)}`;
  return `Nacidos hasta el ${to === null ? '' : formatDate(to)}`;
}

function ageLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `De ${min} a ${max} meses`;
  if (min !== null) return `Desde ${min} meses`;
  return `Hasta ${max ?? 0} meses`;
}

/** Etiquetas derivadas en el orden del panel de filtros. */
export const DERIVED_TAG_KEYS = Object.values(DERIVED_TAG);
