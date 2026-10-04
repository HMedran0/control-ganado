/**
 * Esquemas de la sanidad (SAN-02 a SAN-06; 05-api.md «Sanidad», M6).
 *
 * Toda creación acepta el `id` del cliente y las acciones (vacunación por lote, anulaciones),
 * `Idempotency-Key` (ADR-012).
 */

import { z } from 'zod';

import type { IsoDate } from '../date.js';
import type { BulkVaccinationSkip } from '../domain/vaccination.js';
import type { Warning } from '../errors.js';
import type { MoneyString } from '../money.js';
import { listAnimalsQuerySchema, positiveMoneySchema, type AnimalRef } from './animals.js';
import { isoDateSchema } from './catalogs.js';
import { clientIdSchema } from './offline.js';

const uuidSchema = z.uuid({ message: 'El identificador no es válido.' });

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

/** Días enteros de 0 a 365 (tratamiento y retiros). */
function daysSchema(label: string, min: number) {
  return z
    .int({ message: `Escribe ${label} sin decimales.` })
    .min(min, { message: `Entre ${min} y 365 días.` })
    .max(365, { message: `Entre ${min} y 365 días.` });
}

// ---------------------------------------------------------------------------------------------
// Vacunación (SAN-02, SAN-03)
// ---------------------------------------------------------------------------------------------

/** Campos comunes de una aplicación, individual o por lote. */
const applicationFields = {
  vaccineId: uuidSchema,
  date: isoDateSchema,
  dose: optionalText(60),
  batchNumber: optionalText(60),
  /** Registro Único de Vacunación del vacunador de Fedegán (ciclos oficiales). */
  ruvNumber: optionalText(60),
  responsible: optionalText(120),
  notes: optionalText(2000),
};

/** `POST /vaccinations` (SAN-02). */
export const createVaccinationSchema = z.object({
  id: clientIdSchema.optional(),
  animalId: uuidSchema,
  ...applicationFields,
  /**
   * Próxima fecha, solo en vacunas de intervalo (RN-12). Sin valor, la API la propone con el
   * intervalo de la vacuna; `null`, sin próxima fecha.
   */
  nextDueOn: isoDateSchema.nullable().optional(),
});
export type CreateVaccinationInput = z.infer<typeof createVaccinationSchema>;

/** Máximo de animales de una vacunación por lote. */
export const BULK_VACCINATION_MAX = 5000;

/**
 * `POST /vaccinations/bulk` (SAN-03). Los animales se eligen por `animalIds` o con los filtros del
 * listado (`filter`); `excludeIds` quita animales de la selección (CA3). `?dryRun=true` devuelve el
 * plan sin guardar.
 */
export const bulkVaccinationSchema = z
  .object({
    ...applicationFields,
    animalIds: z.array(uuidSchema).min(1).max(BULK_VACCINATION_MAX).optional(),
    filter: listAnimalsQuerySchema.optional(),
    excludeIds: z.array(uuidSchema).max(BULK_VACCINATION_MAX).optional(),
  })
  .refine((value) => (value.animalIds === undefined) !== (value.filter === undefined), {
    path: ['animalIds'],
    message: 'Elige los animales por selección o por filtros, no ambos.',
  });
export type BulkVaccinationInput = z.infer<typeof bulkVaccinationSchema>;

/** Un animal que se omite en la vacunación por lote, con su motivo. */
export type BulkVaccinationSkipped = {
  readonly animal: AnimalRef;
  readonly reason: BulkVaccinationSkip;
};

/** Respuesta de `POST /vaccinations/bulk` (y de su simulación). */
export type BulkVaccinationResult = {
  readonly dryRun: boolean;
  /** Animales de la selección, antes de omitir. */
  readonly selected: number;
  /** Los que se vacunan (en la simulación, los que se vacunarían). */
  readonly toApply: readonly AnimalRef[];
  /** Vacunaciones creadas; 0 en la simulación. */
  readonly created: number;
  readonly skipped: readonly BulkVaccinationSkipped[];
  /** Animales que se vacunan con advertencia (fuera de la edad recomendada). */
  readonly warnings: readonly { readonly animal: AnimalRef; readonly warning: Warning }[];
  /** Ciclo oficial en que quedan las aplicaciones, si lo hay. */
  readonly cycle: { readonly id: string; readonly name: string } | null;
};

/** Filtros de `GET /vaccinations`. */
export const listVaccinationsQuerySchema = z.object({
  animalId: uuidSchema.optional(),
  vaccineId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type ListVaccinationsQuery = z.infer<typeof listVaccinationsQuerySchema>;

/** Anular un evento (RN-11): el motivo queda en el registro y en la auditoría. */
export const voidEventSchema = z.object({
  reason: z
    .string({ message: 'Escribe el motivo.' })
    .trim()
    .min(3, { message: 'Escribe el motivo (mínimo 3 caracteres).' })
    .max(500, { message: 'Máximo 500 caracteres.' }),
});
export type VoidEventInput = z.infer<typeof voidEventSchema>;

type Voided = { readonly at: string; readonly reason: string | null } | null;

/** Una vacunación, como la muestran la ficha y los listados. */
export type VaccinationView = {
  readonly id: string;
  readonly animal: AnimalRef;
  readonly vaccine: { readonly id: string; readonly name: string };
  readonly appliedOn: IsoDate;
  readonly dose: string | null;
  readonly batchNumber: string | null;
  readonly ruvNumber: string | null;
  readonly cycle: { readonly id: string; readonly name: string } | null;
  readonly responsible: string | null;
  readonly nextDueOn: IsoDate | null;
  readonly notes: string | null;
  readonly workSessionId: string | null;
  readonly voided: Voided;
  readonly createdAt: string;
};

export type VaccinationWithWarnings = VaccinationView & { readonly warnings: readonly Warning[] };

export type VaccinationList = {
  readonly items: readonly VaccinationView[];
  readonly nextCursor: string | null;
};

/** Avance de un ciclo oficial por vacuna (SAN-06 CA2, ADR-004 en el denominador). */
export type CycleProgressView = {
  readonly cycle: {
    readonly id: string;
    readonly name: string;
    readonly startsOn: IsoDate;
    readonly endsOn: IsoDate;
  };
  /** «En curso», «Cerrado» o «Por empezar», respecto a hoy. */
  readonly state: 'CURRENT' | 'CLOSED' | 'UPCOMING';
  readonly vaccines: readonly {
    readonly vaccineId: string;
    readonly name: string;
    /** Animales activos que debían vacunarse en el ciclo. */
    readonly eligible: number;
    readonly vaccinated: number;
    readonly pending: number;
  }[];
};

// ---------------------------------------------------------------------------------------------
// Tratamientos (SAN-05)
// ---------------------------------------------------------------------------------------------

/** `POST /treatments` (SAN-05). `cost` solo lo envía un ADMIN y crea un gasto (RN-20). */
export const createTreatmentSchema = z.object({
  id: clientIdSchema.optional(),
  animalId: uuidSchema,
  startedOn: isoDateSchema,
  reason: z
    .string({ message: 'Escribe el diagnóstico o motivo.' })
    .trim()
    .min(2, { message: 'Escribe el diagnóstico o motivo.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
  medication: z
    .string({ message: 'Escribe el medicamento.' })
    .trim()
    .min(2, { message: 'Escribe el medicamento.' })
    .max(120, { message: 'Máximo 120 caracteres.' }),
  dose: optionalText(60),
  durationDays: daysSchema('los días de tratamiento', 1).default(1),
  withdrawalMeatDays: daysSchema('los días de retiro de carne', 0).default(0),
  withdrawalMilkDays: daysSchema('los días de retiro de leche', 0).default(0),
  responsible: optionalText(120),
  cost: positiveMoneySchema.optional(),
  notes: optionalText(2000),
});
export type CreateTreatmentInput = z.infer<typeof createTreatmentSchema>;

/** Filtros de `GET /treatments`. */
export const listTreatmentsQuerySchema = z.object({
  animalId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type ListTreatmentsQuery = z.infer<typeof listTreatmentsQuerySchema>;

/** Un tratamiento. `cost` solo existe en la respuesta de un ADMIN (RN-20). */
export type TreatmentView = {
  readonly id: string;
  readonly animal: AnimalRef;
  readonly startedOn: IsoDate;
  readonly reason: string;
  readonly medication: string;
  readonly dose: string | null;
  readonly durationDays: number;
  readonly withdrawalMeatDays: number;
  readonly withdrawalMilkDays: number;
  /** Fin del retiro de carne (RN-22); `null` sin retiro de carne. */
  readonly meatWithdrawalUntil: IsoDate | null;
  /** Fin del retiro de leche (M9b); `null` sin retiro de leche. */
  readonly milkWithdrawalUntil: IsoDate | null;
  /** El más lejano de los dos (`withdrawal_until`). */
  readonly withdrawalUntil: IsoDate | null;
  readonly responsible: string | null;
  readonly notes: string | null;
  readonly workSessionId: string | null;
  readonly voided: Voided;
  readonly createdAt: string;
  readonly cost?: MoneyString | null;
};

export type TreatmentList = {
  readonly items: readonly TreatmentView[];
  readonly nextCursor: string | null;
};
