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

/** Esquema de `Farm.settings`. Rechaza claves desconocidas para que una errata no pase callada. */
export const farmSettingsSchema = z
  .object({
    /** Días de gestación de la finca, usados cuando la raza no tiene valor (RN-04). */
    gestationDays: z.int().min(240).max(330).default(DEFAULT_FARM_GESTATION_DAYS),
    /** Edad de destete en meses (08 §1.2). Separa crías de novillas y levante (RN-06). */
    weaningAgeMonths: z.int().min(1).max(24).default(7),
    /** Edad mínima para servir una hembra; por debajo se advierte, no se bloquea (RN-15). */
    minBreedingAgeMonths: z.int().min(6).max(48).default(15),
    /** Días de anticipación de la alerta de parto próximo. */
    calvingAlertDays: z.int().min(0).max(120).default(30),
    /** Días de anticipación de la alerta de vacuna próxima (RN-13). */
    vaccineAlertDays: z.int().min(0).max(120).default(15),
    /** Días desde el servicio sin diagnóstico para alertar (RN-08). */
    unconfirmedServiceAlertDays: z.int().min(1).max(365).default(90),
    /** Patrón del código sugerido para las crías (RN-28, 08 §2.3). */
    calfCodePattern: z
      .string()
      .min(1)
      .max(40)
      .refine(isValidCalfCodePattern, {
        message: 'El patrón debe incluir {NNN} o {N} para el consecutivo.',
      })
      .default(DEFAULT_CALF_CODE_PATTERN),
    /** ¿La finca está en zona de riesgo de rabia silvestre? (08 §1.5) */
    rabiesRiskZone: z.boolean().default(true),
    /** Precio por kilo para avalúos, por categoría de manejo. Montos como cadena decimal. */
    pricePerKgByCategory: z.record(z.string(), z.string()).default({}),
  })
  .strict();

/** Parámetros de la finca ya validados. */
export type FarmSettings = z.infer<typeof farmSettingsSchema>;

/** Valores por defecto (03-modelo-datos.md §2.1). */
export const DEFAULT_FARM_SETTINGS: FarmSettings = farmSettingsSchema.parse({});

/** Valida unos parámetros de finca y aplica los valores por defecto que falten. */
export function parseFarmSettings(value: unknown): FarmSettings {
  return farmSettingsSchema.parse(value);
}
