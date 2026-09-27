/**
 * Esquemas de los catálogos de la finca (CFG-02, SAN-01, SAN-06; 05-api.md «Usuarios y finca»).
 *
 * La API valida con ellos y la web los usa en los formularios, así que el mensaje de un campo
 * es el mismo en los dos lados. Todos los textos van en español de Colombia (06 §7).
 */

import { z } from 'zod';

import { isAfter, isBefore, isIsoDate, type IsoDate } from '../date.js';
import { DEFAULT_GESTATION_DAYS_BY_GROUP } from '../domain/pregnancy.js';
import type { BreedGroup, Role, Sex, VaccineScheduleType } from '../enums.js';
import type { Warning } from '../errors.js';
import { farmSettingsPatchSchema, type FarmSettings } from './farm-settings.js';

// ---------------------------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------------------------

/**
 * Normaliza un nombre de catálogo: sin espacios al inicio ni al final y sin espacios dobles.
 * «  Brahman  rojo » → «Brahman rojo». Es lo que se guarda.
 */
export function normalizeCatalogName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Clave para comparar nombres: normalizada y en minúsculas. «Brahman», «brahman » y
 * «BRAHMAN» dan la misma clave, y la base de datos los trata igual (índice sobre `lower`).
 */
export function catalogNameKey(value: string): string {
  return normalizeCatalogName(value).toLocaleLowerCase('es-CO');
}

/** Nombre de catálogo normalizado, de 1 a 80 caracteres. */
function catalogName(requiredMessage: string) {
  return z
    .string()
    .transform(normalizeCatalogName)
    .pipe(
      z
        .string()
        .min(1, { message: requiredMessage })
        .max(80, { message: 'El nombre es demasiado largo (máximo 80 caracteres).' }),
    );
}

/** Texto libre opcional: vacío o solo espacios cuenta como «sin valor» (`null`). */
function optionalText(max: number) {
  return z
    .string()
    .max(max, { message: `Máximo ${max} caracteres.` })
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    });
}

/** Fecha de negocio `YYYY-MM-DD` (ADR-002). */
export const isoDateSchema = z
  .string()
  .refine(isIsoDate, { message: 'Escribe una fecha válida.' });

/** Versión del registro para el control de concurrencia de `PATCH` (05, «Convenciones»). */
export const versionSchema = z.int().min(1);

/** Un `PATCH` sin nada que cambiar suele ser un error del cliente. */
function hasChanges(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, field]) => key !== 'version' && field !== undefined);
}
const NOTHING_TO_CHANGE = { message: 'No hay nada que cambiar.' };

// ---------------------------------------------------------------------------------------------
// Razas
// ---------------------------------------------------------------------------------------------

export const breedGroupSchema = z.enum(['INDICUS', 'TAURUS', 'CROSS']);

/** Días de gestación admitidos para una raza (08 §1.4: 283 a 293 en las razas semilla). */
export const gestationDaysSchema = z
  .int({ message: 'Escribe los días de gestación sin decimales.' })
  .min(240, { message: 'La gestación debe estar entre 240 y 330 días.' })
  .max(330, { message: 'La gestación debe estar entre 240 y 330 días.' });

export const createBreedSchema = z.object({
  name: catalogName('Escribe el nombre de la raza.'),
  group: breedGroupSchema,
  /** Sin valor, la API propone la del grupo (`DEFAULT_GESTATION_DAYS_BY_GROUP`). */
  gestationDays: gestationDaysSchema.optional(),
});
export type CreateBreedInput = z.infer<typeof createBreedSchema>;

export const updateBreedSchema = z
  .object({
    version: versionSchema,
    name: catalogName('Escribe el nombre de la raza.').optional(),
    group: breedGroupSchema.optional(),
    /** `null`: la raza usa la gestación de la finca (RN-04). */
    gestationDays: gestationDaysSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, NOTHING_TO_CHANGE);
export type UpdateBreedInput = z.infer<typeof updateBreedSchema>;

/** Gestación que se propone para una raza nueva de ese grupo (08 §1.4). */
export function proposedGestationDays(group: BreedGroup): number {
  return DEFAULT_GESTATION_DAYS_BY_GROUP[group];
}

export type BreedView = {
  readonly id: string;
  readonly name: string;
  readonly group: BreedGroup;
  readonly gestationDays: number | null;
  readonly isActive: boolean;
  readonly version: number;
};

// ---------------------------------------------------------------------------------------------
// Vacunas
// ---------------------------------------------------------------------------------------------

export const vaccineScheduleTypeSchema = z.enum([
  'OFFICIAL_CYCLE',
  'AGE_WINDOW',
  'INTERVAL',
  'NONE',
]);
export const sexSchema = z.enum(['MALE', 'FEMALE']);

const ageDays = z
  .int({ message: 'Escribe la edad en días, sin decimales.' })
  .min(0, { message: 'La edad no puede ser negativa.' })
  .max(3650, { message: 'La edad no puede pasar de 3.650 días (10 años).' });

/** Campos de una vacuna tal como quedan guardados. */
export type VaccineRules = {
  readonly scheduleType: VaccineScheduleType;
  readonly boosterIntervalDays: number | null;
  readonly eligibleSex: Sex | null;
  readonly minAgeDays: number | null;
  readonly maxAgeDays: number | null;
  readonly blockIneligibleSex: boolean;
};

/**
 * Coherencia del tipo de programación (08 §1.5). Devuelve los errores por campo; vacío si la
 * vacuna es coherente. Es una función aparte porque la API también la aplica al resultado de
 * un `PATCH` parcial mezclado con lo que ya estaba guardado.
 */
export function vaccineRuleErrors(vaccine: VaccineRules): Record<string, string> {
  const errors: Record<string, string> = {};
  if (vaccine.scheduleType === 'INTERVAL' && vaccine.boosterIntervalDays === null) {
    errors.boosterIntervalDays = 'Indica cada cuántos días se repite la vacuna.';
  }
  if (vaccine.scheduleType !== 'INTERVAL' && vaccine.boosterIntervalDays !== null) {
    errors.boosterIntervalDays = 'Solo las vacunas por intervalo llevan intervalo de refuerzo.';
  }
  if (
    vaccine.scheduleType === 'AGE_WINDOW' &&
    vaccine.minAgeDays === null &&
    vaccine.maxAgeDays === null
  ) {
    errors.minAgeDays = 'Indica la edad mínima, la máxima o ambas.';
  }
  if (
    vaccine.minAgeDays !== null &&
    vaccine.maxAgeDays !== null &&
    vaccine.minAgeDays > vaccine.maxAgeDays
  ) {
    errors.maxAgeDays = 'La edad máxima no puede ser menor que la mínima.';
  }
  if (vaccine.blockIneligibleSex && vaccine.eligibleSex === null) {
    errors.eligibleSex = 'Para bloquear el otro sexo, indica a qué sexo se aplica la vacuna.';
  }
  return errors;
}

const vaccineFields = {
  name: catalogName('Escribe el nombre de la vacuna.'),
  disease: z
    .string()
    .transform(normalizeCatalogName)
    .pipe(
      z
        .string()
        .min(1, { message: 'Escribe la enfermedad o el propósito.' })
        .max(120, { message: 'Máximo 120 caracteres.' }),
    ),
  defaultDose: optionalText(40),
  route: optionalText(40),
  scheduleType: vaccineScheduleTypeSchema,
  boosterIntervalDays: z
    .int({ message: 'Escribe el intervalo en días, sin decimales.' })
    .min(1, { message: 'El intervalo debe ser de al menos 1 día.' })
    .max(3650, { message: 'El intervalo no puede pasar de 3.650 días.' })
    .nullable()
    .optional(),
  eligibleSex: sexSchema.nullable().optional(),
  minAgeDays: ageDays.nullable().optional(),
  maxAgeDays: ageDays.nullable().optional(),
  blockIneligibleSex: z.boolean().optional(),
};

/** Aplica `vaccineRuleErrors` dentro de zod, con cada error en su campo. */
function refineVaccine(value: Partial<Record<keyof VaccineRules, unknown>>, ctx: z.RefinementCtx) {
  const errors = vaccineRuleErrors({
    scheduleType: value.scheduleType as VaccineScheduleType,
    boosterIntervalDays: (value.boosterIntervalDays as number | null | undefined) ?? null,
    eligibleSex: (value.eligibleSex as Sex | null | undefined) ?? null,
    minAgeDays: (value.minAgeDays as number | null | undefined) ?? null,
    maxAgeDays: (value.maxAgeDays as number | null | undefined) ?? null,
    blockIneligibleSex: (value.blockIneligibleSex as boolean | undefined) ?? false,
  });
  for (const [path, message] of Object.entries(errors)) {
    ctx.addIssue({ code: 'custom', path: [path], message });
  }
}

export const createVaccineSchema = z.object(vaccineFields).superRefine(refineVaccine);
export type CreateVaccineInput = z.infer<typeof createVaccineSchema>;

/**
 * `PATCH /vaccines/:id`. La coherencia no se puede revisar aquí con los campos sueltos: la API
 * la revisa sobre la vacuna ya mezclada con lo guardado (`vaccineRuleErrors`).
 */
export const updateVaccineSchema = z
  .object({
    version: versionSchema,
    name: vaccineFields.name.optional(),
    disease: vaccineFields.disease.optional(),
    defaultDose: vaccineFields.defaultDose,
    route: vaccineFields.route,
    scheduleType: vaccineFields.scheduleType.optional(),
    boosterIntervalDays: vaccineFields.boosterIntervalDays,
    eligibleSex: vaccineFields.eligibleSex,
    minAgeDays: vaccineFields.minAgeDays,
    maxAgeDays: vaccineFields.maxAgeDays,
    blockIneligibleSex: vaccineFields.blockIneligibleSex,
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, NOTHING_TO_CHANGE);
export type UpdateVaccineInput = z.infer<typeof updateVaccineSchema>;

export type VaccineView = VaccineRules & {
  readonly id: string;
  readonly name: string;
  readonly disease: string;
  readonly defaultDose: string | null;
  readonly route: string | null;
  readonly isActive: boolean;
  readonly version: number;
};

// ---------------------------------------------------------------------------------------------
// Ciclos de vacunación
// ---------------------------------------------------------------------------------------------

const cycleFields = {
  name: catalogName('Escribe el nombre del ciclo, por ejemplo 2026-2.'),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  isOfficial: z.boolean().optional(),
  vaccineIds: z
    .array(z.uuid())
    .min(1, { message: 'Elige al menos una vacuna del ciclo.' })
    .transform((ids) => [...new Set(ids)]),
};

/** La fecha de fin no puede quedar antes de la de inicio. */
export function cycleDatesError(startsOn: IsoDate, endsOn: IsoDate): string | null {
  return isBefore(endsOn, startsOn)
    ? 'La fecha de fin no puede ser anterior a la de inicio.'
    : null;
}

export const createCycleSchema = z.object(cycleFields).superRefine((value, ctx) => {
  const error = cycleDatesError(value.startsOn, value.endsOn);
  if (error !== null) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: error });
});
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const updateCycleSchema = z
  .object({
    version: versionSchema,
    name: cycleFields.name.optional(),
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.optional(),
    isOfficial: z.boolean().optional(),
    vaccineIds: cycleFields.vaccineIds.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, NOTHING_TO_CHANGE);
export type UpdateCycleInput = z.infer<typeof updateCycleSchema>;

/** ¿Se cruzan dos rangos de fechas (con los extremos incluidos)? */
export function rangesOverlap(
  a: { startsOn: IsoDate; endsOn: IsoDate },
  b: { startsOn: IsoDate; endsOn: IsoDate },
): boolean {
  return !isAfter(a.startsOn, b.endsOn) && !isBefore(a.endsOn, b.startsOn);
}

export type CycleView = {
  readonly id: string;
  readonly name: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
  readonly isOfficial: boolean;
  readonly isActive: boolean;
  readonly version: number;
  readonly vaccines: readonly { readonly id: string; readonly name: string }[];
};

// ---------------------------------------------------------------------------------------------
// Lotes y etiquetas
// ---------------------------------------------------------------------------------------------

export const createLotSchema = z.object({
  name: catalogName('Escribe el nombre del lote.'),
  description: optionalText(200),
});
export type CreateLotInput = z.infer<typeof createLotSchema>;

export const updateLotSchema = z
  .object({
    version: versionSchema,
    name: catalogName('Escribe el nombre del lote.').optional(),
    description: optionalText(200),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, NOTHING_TO_CHANGE);
export type UpdateLotInput = z.infer<typeof updateLotSchema>;

export type LotView = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly version: number;
};

export const createTagSchema = z.object({
  label: catalogName('Escribe el nombre de la etiqueta.'),
  description: optionalText(200),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z
  .object({
    version: versionSchema,
    label: catalogName('Escribe el nombre de la etiqueta.').optional(),
    description: optionalText(200),
    isActive: z.boolean().optional(),
  })
  .refine(hasChanges, NOTHING_TO_CHANGE);
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export type TagView = {
  readonly id: string;
  /** Clave estable: se genera al crear la etiqueta y no cambia al renombrarla. */
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isActive: boolean;
  readonly version: number;
};

/**
 * Clave de una etiqueta nueva a partir de su nombre: mayúsculas, sin tildes, palabras unidas
 * por «_». «Disponible para venta» → `DISPONIBLE_PARA_VENTA`.
 */
export function tagKeyFromLabel(label: string): string {
  const key = normalizeCatalogName(label)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key === '' ? 'ETIQUETA' : key.slice(0, 40);
}

// ---------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------

/** Listado de catálogo: completo, sin paginar (son pocos); `nextCursor` mantiene la forma de 05. */
export type CatalogList<T> = { readonly items: readonly T[]; readonly nextCursor: null };

// ---------------------------------------------------------------------------------------------
// Finca (CFG-01)
// ---------------------------------------------------------------------------------------------

/**
 * `PATCH /farm`. Los `settings` llegan parciales: la API los mezcla con los guardados y valida
 * el resultado completo con `farmSettingsSchema`.
 */
export const updateFarmSchema = z
  .object({
    version: versionSchema,
    name: catalogName('Escribe el nombre de la finca.').optional(),
    municipality: optionalText(80),
    department: optionalText(80),
    icaPremiseCode: optionalText(40),
    settings: farmSettingsPatchSchema.optional(),
  })
  .refine(hasChanges, NOTHING_TO_CHANGE);
export type UpdateFarmInput = z.infer<typeof updateFarmSchema>;

/** Parámetros que otros roles pueden ver: sin los datos económicos (RN-20). */
export type PublicFarmSettings = Omit<FarmSettings, 'pricePerKgByCategory'>;

export type FarmView = {
  readonly id: string;
  readonly name: string;
  readonly municipality: string | null;
  readonly department: string | null;
  readonly icaPremiseCode: string | null;
  /** `pricePerKgByCategory` solo viene para ADMIN (RN-20). */
  readonly settings: PublicFarmSettings & {
    readonly pricePerKgByCategory?: Record<string, string>;
  };
  readonly version: number;
};

/**
 * Parámetros visibles para un rol. El precio por kilo es un dato económico: fuera de ADMIN,
 * el campo no viaja en la respuesta (ni vacío ni en cero).
 */
export function farmSettingsFor(role: Role, settings: FarmSettings): FarmView['settings'] {
  if (role === 'ADMIN') return settings;
  const { pricePerKgByCategory: _hidden, ...visible } = settings;
  return visible;
}

/**
 * Parámetros que cambian de inmediato las categorías y fechas calculadas (CFG-01 CA1): la web
 * lo advierte antes de guardar.
 */
export const CATEGORY_AFFECTING_SETTINGS = ['weaningAgeMonths', 'gestationDays'] as const;

/** Respuesta de una escritura con sus advertencias no bloqueantes (05, «Catálogo de errores»). */
export type WithWarnings<T> = T & { readonly warnings: readonly Warning[] };

/** `GET /<catálogo>/:id/deactivation-warnings`: lo que pasaría al desactivar, antes de hacerlo. */
export type DeactivationWarnings = { readonly warnings: readonly Warning[] };
