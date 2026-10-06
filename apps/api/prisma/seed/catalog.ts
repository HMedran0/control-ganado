/**
 * Catálogos de la finca de referencia: finca, usuarios, razas, vacunas, ciclos oficiales,
 * lotes y etiquetas manuales.
 *
 * Todos los datos son **ficticios** y salen de `08-dominio-y-finca-referencia.md` §3 y de
 * `03-modelo-datos.md` §2.2. Las únicas fechas reales son las de los ciclos oficiales de
 * vacunación 2025-2 y 2026-1, publicadas por el ICA.
 */

import {
  BREEDER_TAG_KEY,
  BREED_GROUP,
  DEFAULT_CALF_CODE_PATTERN,
  DEFAULT_FARM_GESTATION_DAYS,
  defaultGestationDaysForGroup,
  parseFarmSettings,
  ROLE,
  SEX,
  toIsoDate,
  VACCINE_SCHEDULE_TYPE,
  type BreedGroup,
  type FarmSettings,
  type IsoDate,
  type Role,
  type Sex,
  type VaccineScheduleType,
} from '@hato/shared';

import { derivedId, type IdFactory } from './ids.js';

/** Precio de referencia en pie, $/kg (08 §3.4). Ficticio. */
export const PRICE_PER_KG = 7_800;

/** Parámetros de la finca (03-modelo-datos.md §2.1 con los valores de 08 §1.2–1.5). */
export function referenceFarmSettings(): FarmSettings {
  return parseFarmSettings({
    gestationDays: DEFAULT_FARM_GESTATION_DAYS,
    weaningAgeMonths: 7,
    minBreedingAgeMonths: 15,
    calvingAlertDays: 30,
    vaccineAlertDays: 15,
    unconfirmedServiceAlertDays: 90,
    calfCodePattern: DEFAULT_CALF_CODE_PATTERN,
    rabiesRiskZone: true,
    pricePerKgByCategory: {
      CALF_MALE: `${PRICE_PER_KG}.00`,
      CALF_FEMALE: `${PRICE_PER_KG}.00`,
      HEIFER: `${PRICE_PER_KG}.00`,
      COW: `${PRICE_PER_KG}.00`,
      YOUNG_MALE: `${PRICE_PER_KG}.00`,
      ADULT_MALE: `${PRICE_PER_KG}.00`,
    },
  });
}

/** Datos de la finca (08 §3). */
export const FARM = {
  name: 'Finca La Esperanza',
  municipality: 'San Juan Nepomuceno',
  department: 'Bolívar',
  icaPremiseCode: '13657-0000-0001',
  /** Hierro de la finca; se graba como identificador `BRAND` en los adultos (08 §1.6). */
  brand: 'LE',
} as const;

/** Usuario de demostración (08 §3.1). */
export type SeedUser = {
  readonly username: string;
  readonly name: string;
  readonly email: string | null;
  readonly role: Role;
};

/** Los cuatro usuarios de 08 §3.1. El mayordomo y el vaquero no tienen correo (08 §1.8). */
export const USERS: readonly SeedUser[] = [
  { username: 'alvaro', name: 'Álvaro Pérez Castro', email: 'alvaro@demo.co', role: ROLE.ADMIN },
  { username: 'wilmer', name: 'Wilmer Ortega', email: null, role: ROLE.OPERATOR },
  { username: 'yeison', name: 'Yeison Mendoza', email: null, role: ROLE.OPERATOR },
  { username: 'paola.vet', name: 'Dra. Paola Barrios', email: 'vet@demo.co', role: ROLE.VET },
];

/** Raza del catálogo semilla. */
export type SeedBreed = {
  readonly name: string;
  readonly group: BreedGroup;
};

/**
 * Catálogo de razas (03-modelo-datos.md §2.2). La gestación de cada una es la de su grupo
 * (08 §1.4): no se escribe a mano, sale de `defaultGestationDaysForGroup`.
 */
export const BREEDS: readonly SeedBreed[] = [
  { name: 'Brahman', group: BREED_GROUP.INDICUS },
  { name: 'Cebú comercial', group: BREED_GROUP.INDICUS },
  { name: 'Gyr', group: BREED_GROUP.INDICUS },
  { name: 'Guzerá', group: BREED_GROUP.INDICUS },
  { name: 'Nelore', group: BREED_GROUP.INDICUS },
  { name: 'Holstein', group: BREED_GROUP.TAURUS },
  { name: 'Pardo suizo', group: BREED_GROUP.TAURUS },
  { name: 'Simmental', group: BREED_GROUP.TAURUS },
  { name: 'Angus', group: BREED_GROUP.TAURUS },
  { name: 'Romosinuano', group: BREED_GROUP.TAURUS },
  { name: 'Costeño con cuernos', group: BREED_GROUP.TAURUS },
  { name: 'Blanco orejinegro', group: BREED_GROUP.TAURUS },
  { name: 'Cruce', group: BREED_GROUP.CROSS },
  { name: 'Girolando', group: BREED_GROUP.CROSS },
  { name: 'Brahman × Pardo', group: BREED_GROUP.CROSS },
];

/** Razas del hato y su participación (08 §3.2). */
export const HERD_BREED_MIX = [
  { name: 'Brahman', share: 40 },
  { name: 'Brahman × Pardo', share: 30 },
  { name: 'Girolando', share: 20 },
  { name: 'Romosinuano', share: 10 },
] as const;

/** Vacuna del plan sanitario (08 §3.3). */
export type SeedVaccine = {
  readonly key: 'FMD' | 'BRUCELLOSIS' | 'RABIES' | 'CLOSTRIDIAL';
  readonly name: string;
  readonly disease: string;
  readonly defaultDose: string;
  readonly route: string;
  readonly scheduleType: VaccineScheduleType;
  readonly boosterIntervalDays: number | null;
  readonly eligibleSex: Sex | null;
  readonly minAgeDays: number | null;
  readonly maxAgeDays: number | null;
  readonly blockIneligibleSex: boolean;
  /** ¿Forma parte de los ciclos oficiales del ICA? */
  readonly inOfficialCycle: boolean;
};

/** Plan sanitario de referencia (08 §3.3). */
export const VACCINES: readonly SeedVaccine[] = [
  {
    key: 'FMD',
    name: 'Aftosa',
    disease: 'Fiebre aftosa',
    defaultDose: '2 ml',
    route: 'Subcutánea',
    scheduleType: VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE,
    boosterIntervalDays: null,
    eligibleSex: null,
    minAgeDays: null,
    maxAgeDays: null,
    blockIneligibleSex: false,
    inOfficialCycle: true,
  },
  {
    key: 'BRUCELLOSIS',
    name: 'Brucelosis RB51',
    disease: 'Brucelosis bovina',
    defaultDose: '2 ml',
    route: 'Subcutánea',
    // Hembras de 3 a 9 meses; prohibida en machos por norma del ICA (RN-26).
    scheduleType: VACCINE_SCHEDULE_TYPE.AGE_WINDOW,
    boosterIntervalDays: null,
    eligibleSex: SEX.FEMALE,
    minAgeDays: 90,
    maxAgeDays: 270,
    blockIneligibleSex: true,
    inOfficialCycle: false,
  },
  {
    key: 'RABIES',
    name: 'Rabia silvestre',
    disease: 'Rabia de origen silvestre',
    defaultDose: '2 ml',
    route: 'Intramuscular',
    scheduleType: VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE,
    boosterIntervalDays: null,
    eligibleSex: null,
    minAgeDays: null,
    maxAgeDays: null,
    blockIneligibleSex: false,
    inOfficialCycle: true,
  },
  {
    key: 'CLOSTRIDIAL',
    name: 'Clostridial polivalente',
    disease: 'Clostridiosis',
    defaultDose: '5 ml',
    route: 'Subcutánea',
    scheduleType: VACCINE_SCHEDULE_TYPE.INTERVAL,
    boosterIntervalDays: 365,
    eligibleSex: null,
    minAgeDays: 90,
    maxAgeDays: null,
    blockIneligibleSex: false,
    inOfficialCycle: false,
  },
];

/** Ciclo oficial de vacunación. */
export type SeedCycle = {
  readonly name: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
};

/**
 * Ciclos configurados (08 §3.3). Los de 2025-2 y 2026-1 son **reales** (fechas del ICA);
 * el de 2026-2 es ficticio y hay que reemplazarlo cuando el ICA lo publique.
 */
export const CYCLES: readonly SeedCycle[] = [
  { name: '2025-2', startsOn: toIsoDate('2025-10-27'), endsOn: toIsoDate('2025-12-16') },
  { name: '2026-1', startsOn: toIsoDate('2026-05-04'), endsOn: toIsoDate('2026-06-23') },
  { name: '2026-2', startsOn: toIsoDate('2026-11-01'), endsOn: toIsoDate('2026-12-15') },
];

/** Lotes semilla (08 §1.10). */
export const LOTS = [
  { key: 'PARIDAS', name: 'Paridas', description: 'Vacas con cría al pie y sus crías' },
  {
    key: 'HORRAS',
    name: 'Horras y novillas',
    description: 'Vacas sin cría al pie y hembras de levante',
  },
  { key: 'LEVANTE', name: 'Levante', description: 'Machos destetados' },
  { key: 'TOROS', name: 'Toros', description: 'Reproductores y bueyes coteros' },
] as const;

/** Clave de lote, para referirse a ellos sin cadenas sueltas. */
export type LotKey = (typeof LOTS)[number]['key'];

/** Etiqueta manual semilla (08 §1.1). */
export const TAGS = [
  {
    key: 'COTERO',
    label: 'Cotero',
    description:
      'Animal destinado a trabajo (carga, tiro) o a un uso específico definido por la finca',
    isSystem: true,
  },
  {
    // M8a: el macho reproductor no tiene peso objetivo de venta (PES-06). Su identificador sale
    // de `derivedId` (ver `buildCatalog`) para no mover ningún identificador anterior.
    key: BREEDER_TAG_KEY,
    label: 'Reproductor',
    description: 'Macho que la finca conserva para servir: no tiene peso objetivo de venta',
    isSystem: true,
  },
] as const;

/** Catálogos ya con identificador, listos para escribir y para que el hato los referencie. */
export type Catalog = {
  readonly farmId: string;
  readonly settings: FarmSettings;
  readonly users: readonly { id: string; membershipId: string; user: SeedUser }[];
  /** Usuario que figura como autor de los datos sembrados: el administrador. */
  readonly authorId: string;
  readonly breedIds: ReadonlyMap<string, string>;
  readonly breedGroups: ReadonlyMap<string, BreedGroup>;
  readonly breedGestationDays: ReadonlyMap<string, number>;
  readonly vaccineIds: ReadonlyMap<SeedVaccine['key'], string>;
  readonly cycleIds: ReadonlyMap<string, string>;
  readonly lotIds: ReadonlyMap<LotKey, string>;
  readonly tagIds: ReadonlyMap<string, string>;
};

/** Asigna identificadores deterministas a todos los catálogos. */
export function buildCatalog(ids: IdFactory): Catalog {
  const farmId = ids.next();

  const users = USERS.map((user) => ({
    id: ids.next(),
    membershipId: ids.next(),
    user,
  }));

  const breedIds = new Map<string, string>();
  const breedGroups = new Map<string, BreedGroup>();
  const breedGestationDays = new Map<string, number>();
  for (const breed of BREEDS) {
    breedIds.set(breed.name, ids.next());
    breedGroups.set(breed.name, breed.group);
    breedGestationDays.set(breed.name, defaultGestationDaysForGroup(breed.group));
  }

  const vaccineIds = new Map<SeedVaccine['key'], string>();
  for (const vaccine of VACCINES) vaccineIds.set(vaccine.key, ids.next());

  const cycleIds = new Map<string, string>();
  for (const cycle of CYCLES) cycleIds.set(cycle.name, ids.next());

  const lotIds = new Map<LotKey, string>();
  for (const lot of LOTS) lotIds.set(lot.key, ids.next());

  const tagIds = new Map<string, string>();
  for (const tag of TAGS) {
    // Las etiquetas agregadas después de M3 no consumen el generador: así los identificadores de
    // todo lo demás no cambian.
    tagIds.set(
      tag.key,
      tag.key === BREEDER_TAG_KEY ? derivedId(`tag:${tag.key}`, '2026-01-01') : ids.next(),
    );
  }

  const admin = users[0];
  if (admin === undefined) throw new Error('El catálogo de usuarios no puede estar vacío.');

  return {
    farmId,
    settings: referenceFarmSettings(),
    users,
    authorId: admin.id,
    breedIds,
    breedGroups,
    breedGestationDays,
    vaccineIds,
    cycleIds,
    lotIds,
    tagIds,
  };
}

/** Identificador de un catálogo, con un error claro si falta. */
export function required<K>(map: ReadonlyMap<K, string>, key: K, what: string): string {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Falta ${what} «${String(key)}» en el catálogo.`);
  return value;
}
