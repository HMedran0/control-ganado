/**
 * Parámetros de la finca (`Farm.settings`, columna jsonb) validados con zod.
 * Valores por defecto de 03-modelo-datos.md §2.1 y 08 §1.2–1.4.
 *
 * Es el único esquema zod de M0.2: los esquemas de los recursos de la API llegan con cada
 * módulo. Al ser jsonb, nada en la base de datos garantiza su forma, así que la API lo valida
 * al leer y al escribir.
 */

import { z } from 'zod';

import { DEFAULT_CALF_CODE_PATTERN, isValidCalfCodePattern } from '../domain/codes.js';
import { DEFAULT_FARM_GESTATION_DAYS } from '../domain/pregnancy.js';
import { DEFAULT_WEIGHT_GAIN_ANCHOR_MAX_DAYS } from '../domain/weights.js';
import { MANAGEMENT_CATEGORY, type ManagementCategory } from '../enums.js';

/** «Parto vencido sin registrar» a los 15 días del parto estimado [Validar] (M5). */
export const DEFAULT_OVERDUE_CALVING_ALERT_DAYS = 15;

/** «Ganancia baja» en Levante por debajo de 0,30 kg/día [Validar] (PES-05 CA2, 08 §3.7). */
export const DEFAULT_WEIGHT_GAIN_ALERT_KG_PER_DAY: Partial<Record<ManagementCategory, number>> = {
  [MANAGEMENT_CATEGORY.YOUNG_MALE]: 0.3,
};
/** «Perdió peso» si el último pesaje baja más de 5 % [Validar] (PES-05 CA3, 08 §3.7). */
export const DEFAULT_WEIGHT_LOSS_ALERT_PERCENT = 5;

/** Umbral de ganancia en kg/día: de 0 a 3 kg/día, con hasta tres decimales (ADR-015). */
const gainThresholdSchema = z
  .number({ message: 'Escribe la ganancia en kg/día.' })
  .min(0, { message: 'La ganancia no puede ser negativa.' })
  .max(3, { message: 'Máximo 3 kg/día.' })
  .refine((value) => Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6, {
    message: 'Máximo tres decimales.',
  });

/**
 * Cómo sugiere la finca el código de un animal nuevo (ANI-10): con el patrón de las crías o con
 * el menor número libre.
 */
export const CODE_SUGGESTION = {
  PATTERN: 'PATTERN',
  LOWEST_FREE: 'LOWEST_FREE',
} as const;
export type CodeSuggestion = (typeof CODE_SUGGESTION)[keyof typeof CODE_SUGGESTION];

/**
 * Campos de `Farm.settings` sin valores por defecto. Se separan de ellos porque en zod 4
 * `.partial()` sigue aplicando los `.default()`: un cambio parcial («solo el destete») habría
 * devuelto el resto de la configuración a sus valores de fábrica.
 */
const settingsFields = {
  /** Días de gestación de la finca, usados cuando la raza no tiene valor (RN-04). */
  gestationDays: z.int().min(240).max(330),
  /** Edad de destete en meses (08 §1.2). Separa crías de novillas y levante (RN-06). */
  weaningAgeMonths: z.int().min(1).max(24),
  /** Edad mínima para servir una hembra; por debajo se advierte, no se bloquea (RN-15). */
  minBreedingAgeMonths: z.int().min(6).max(48),
  /** Días de anticipación de la alerta de parto próximo. */
  calvingAlertDays: z.int().min(0).max(120),
  /** Días de anticipación de la alerta de vacuna próxima (RN-13). */
  vaccineAlertDays: z.int().min(0).max(120),
  /** Días desde el servicio sin diagnóstico para alertar (RN-08). */
  unconfirmedServiceAlertDays: z.int().min(1).max(365),
  /**
   * Días después del parto estimado de una preñez abierta para alertar «Parto vencido sin
   * registrar» (M5). 15 por defecto [Validar] con la finca.
   */
  overdueCalvingAlertDays: z.int().min(0).max(120),
  /** Patrón del código sugerido para las crías (RN-28, 08 §2.3). */
  calfCodePattern: z.string().min(1).max(40).refine(isValidCalfCodePattern, {
    message: 'El patrón debe incluir {NNN} o {N} para el consecutivo.',
  }),
  /** ¿La finca está en zona de riesgo de rabia silvestre? (08 §1.5) */
  rabiesRiskZone: z.boolean(),
  /**
   * Reutilizar el número de un animal que salió de la finca (ANI-10). Con `true`, el código solo
   * es único entre los animales activos (RN-01, RN-31).
   */
  codeReuse: z.boolean(),
  /** Sugerencia de código: patrón de las crías o menor número libre (ANI-10 CA2). */
  codeSuggestion: z.enum([CODE_SUGGESTION.PATTERN, CODE_SUGGESTION.LOWEST_FREE], {
    message: 'Elige cómo se sugiere el código.',
  }),
  /** Precio por kilo para avalúos, por categoría de manejo. Montos como cadena decimal. */
  pricePerKgByCategory: z.record(z.string(), z.string()),
  /**
   * Umbral de «Ganancia baja» por categoría de manejo, en kg/día (PES-05 CA2). Una categoría sin
   * umbral no genera la alerta.
   */
  weightGainAlertKgPerDay: z.partialRecord(
    z.enum(Object.values(MANAGEMENT_CATEGORY) as [ManagementCategory, ...ManagementCategory[]]),
    gainThresholdSchema,
  ),
  /** «Perdió peso»: porcentaje entero de baja respecto al pesaje anterior (PES-05 CA3). */
  weightLossAlertPercent: z
    .int({ message: 'Escribe un porcentaje sin decimales.' })
    .min(1, { message: 'Entre 1 % y 50 %.' })
    .max(50, { message: 'Entre 1 % y 50 %.' }),
  /**
   * Días máximos entre el ancla de la ganancia de 90 días y el inicio de la ventana (ADR-015,
   * 180 [Validar]). Con un ancla más vieja no hay ganancia de 90 días ni alerta.
   */
  weightGainAnchorMaxDays: z
    .int({ message: 'Escribe los días sin decimales.' })
    .min(0, { message: 'Entre 0 y 365 días.' })
    .max(365, { message: 'Entre 0 y 365 días.' }),
};

/** Esquema de `Farm.settings`. Rechaza claves desconocidas para que una errata no pase callada. */
export const farmSettingsSchema = z
  .object({
    gestationDays: settingsFields.gestationDays.default(DEFAULT_FARM_GESTATION_DAYS),
    weaningAgeMonths: settingsFields.weaningAgeMonths.default(7),
    minBreedingAgeMonths: settingsFields.minBreedingAgeMonths.default(15),
    calvingAlertDays: settingsFields.calvingAlertDays.default(30),
    vaccineAlertDays: settingsFields.vaccineAlertDays.default(15),
    unconfirmedServiceAlertDays: settingsFields.unconfirmedServiceAlertDays.default(90),
    overdueCalvingAlertDays: settingsFields.overdueCalvingAlertDays.default(
      DEFAULT_OVERDUE_CALVING_ALERT_DAYS,
    ),
    calfCodePattern: settingsFields.calfCodePattern.default(DEFAULT_CALF_CODE_PATTERN),
    rabiesRiskZone: settingsFields.rabiesRiskZone.default(true),
    pricePerKgByCategory: settingsFields.pricePerKgByCategory.default({}),
    codeReuse: settingsFields.codeReuse.default(false),
    codeSuggestion: settingsFields.codeSuggestion.default(CODE_SUGGESTION.PATTERN),
    weightGainAlertKgPerDay: settingsFields.weightGainAlertKgPerDay.default(
      DEFAULT_WEIGHT_GAIN_ALERT_KG_PER_DAY,
    ),
    weightLossAlertPercent: settingsFields.weightLossAlertPercent.default(
      DEFAULT_WEIGHT_LOSS_ALERT_PERCENT,
    ),
    weightGainAnchorMaxDays: settingsFields.weightGainAnchorMaxDays.default(
      DEFAULT_WEIGHT_GAIN_ANCHOR_MAX_DAYS,
    ),
  })
  .strict();

/**
 * Cambio parcial de `Farm.settings` (`PATCH /farm`): solo los campos enviados, sin valores
 * por defecto. La API lo mezcla con lo guardado y valida el resultado con `farmSettingsSchema`.
 */
export const farmSettingsPatchSchema = z.object(settingsFields).partial().strict();

/** Parámetros de la finca ya validados. */
export type FarmSettings = z.infer<typeof farmSettingsSchema>;

/** Valores por defecto (03-modelo-datos.md §2.1). */
export const DEFAULT_FARM_SETTINGS: FarmSettings = farmSettingsSchema.parse({});

/** Valida unos parámetros de finca y aplica los valores por defecto que falten. */
export function parseFarmSettings(value: unknown): FarmSettings {
  return farmSettingsSchema.parse(value);
}
