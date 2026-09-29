/**
 * Esquemas del control reproductivo y los nacimientos (REP-01 a REP-05, NAC-01; 05-api.md
 * «Reproducción»).
 *
 * La API valida con ellos y la web los usa en los formularios de servicio, palpación, aborto y
 * parto. Toda creación acepta el `id` del cliente y las acciones, `Idempotency-Key` (ADR-012).
 */

import { z } from 'zod';

import type { IsoDate } from '../date.js';
import {
  MAX_CALVES_PER_CALVING,
  MAX_ESTIMATED_GESTATION_MONTHS,
  MIN_CALVES_PER_CALVING,
} from '../domain/reproduction.js';
import {
  CALF_HEALTH,
  CALVING_TYPE,
  DIAGNOSIS_RESULT,
  SERVICE_METHOD,
  type BirthCondition,
  type CalvingType,
  type PregnancyOutcome,
  type Sex,
  type ServiceMethod,
} from '../enums.js';
import type { Warning } from '../errors.js';
import {
  animalCodeSchema,
  identifierTypeSchema,
  weightKgSchema,
  type AnimalRef,
} from './animals.js';
import { isoDateSchema, versionSchema } from './catalogs.js';
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

export const serviceMethodSchema = z.enum(
  [SERVICE_METHOD.NATURAL, SERVICE_METHOD.AI, SERVICE_METHOD.UNKNOWN],
  { message: 'Elige monta natural o inseminación.' },
);
export const calvingTypeSchema = z.enum(
  [CALVING_TYPE.NORMAL, CALVING_TYPE.ASSISTED, CALVING_TYPE.CESAREAN],
  { message: 'Elige el tipo de parto.' },
);
export const calfHealthSchema = z.enum(
  [CALF_HEALTH.ALIVE, CALF_HEALTH.WEAK, CALF_HEALTH.STILLBORN],
  { message: 'Elige el estado de la cría.' },
);
export const diagnosisResultSchema = z.enum(
  [DIAGNOSIS_RESULT.POSITIVE, DIAGNOSIS_RESULT.NEGATIVE],
  { message: 'Elige el resultado.' },
);

// ---------------------------------------------------------------------------------------------
// Servicio (REP-01) y preñez confirmada sin servicio conocido (REP-02 CA3)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /pregnancies`. Dos formas, excluyentes:
 *
 * - **servicio**: `serviceDate` y `method` (y, si se conoce, el toro de la finca o la referencia
 *   externa);
 * - **preñez confirmada sin servicio**: `gestationMonths` y `diagnosisDate`; la API calcula la
 *   fecha de servicio estimada y la deja confirmada en el diagnóstico.
 */
export const createPregnancySchema = z
  .object({
    id: clientIdSchema.optional(),
    damId: uuidSchema,
    serviceDate: isoDateSchema.optional(),
    method: serviceMethodSchema.optional(),
    sireId: uuidSchema.nullable().optional(),
    sireExternalRef: optionalText(80),
    responsible: optionalText(120),
    notes: optionalText(2000),
    gestationMonths: z
      .int({ message: 'Escribe los meses sin decimales.' })
      .min(1, { message: 'Entre 1 y 9 meses.' })
      .max(MAX_ESTIMATED_GESTATION_MONTHS, { message: 'Entre 1 y 9 meses.' })
      .optional(),
    diagnosisDate: isoDateSchema.optional(),
    diagnosisResponsible: optionalText(120),
    diagnosisResponsibleUserId: uuidSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const byService = value.serviceDate !== undefined;
    const byDiagnosis = value.gestationMonths !== undefined;
    if (byService === byDiagnosis) {
      ctx.addIssue({
        code: 'custom',
        path: [byService ? 'gestationMonths' : 'serviceDate'],
        message: byService
          ? 'Indica la fecha de servicio o los meses de gestación, no ambos.'
          : 'Indica la fecha de servicio.',
      });
    }
    if (byService && value.method === undefined) {
      ctx.addIssue({ code: 'custom', path: ['method'], message: 'Elige el método.' });
    }
    if (byDiagnosis && value.diagnosisDate === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['diagnosisDate'],
        message: 'Indica la fecha de la palpación.',
      });
    }
    if (value.sireId != null && value.sireExternalRef != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['sireExternalRef'],
        message: 'Indica el toro de la finca o la referencia externa, no ambos.',
      });
    }
  });
export type CreatePregnancyInput = z.infer<typeof createPregnancySchema>;

/** `POST /pregnancies/:id/diagnosis` (REP-02). */
export const diagnosisSchema = z.object({
  date: isoDateSchema,
  result: diagnosisResultSchema,
  /** Quién palpó: normalmente un veterinario externo que no es usuario. */
  responsible: optionalText(120),
  /** Si quien palpó es usuario de la finca. */
  responsibleUserId: uuidSchema.nullable().optional(),
});
export type DiagnosisInput = z.infer<typeof diagnosisSchema>;

/** `POST /pregnancies/:id/abortion` (REP-03). */
export const abortionSchema = z.object({
  date: isoDateSchema,
  notes: optionalText(2000),
});
export type AbortionInput = z.infer<typeof abortionSchema>;

/**
 * `PATCH /pregnancies/:id`: corrige una preñez. Las fechas solo se corrigen mientras está abierta;
 * una cerrada solo cambia método, toro, responsable y observaciones.
 *
 * - Cambiar `serviceDate` recalcula el parto estimado (RN-04), salvo que llegue también
 *   `expectedCalvingDate`.
 * - `expectedCalvingDate` es la corrección a mano del parto estimado: la preñez queda marcada y el
 *   recálculo automático por cambios de gestación ya no la toca.
 */
export const updatePregnancySchema = z
  .object({
    version: versionSchema,
    serviceDate: isoDateSchema.optional(),
    method: serviceMethodSchema.optional(),
    sireId: uuidSchema.nullable().optional(),
    sireExternalRef: optionalText(80),
    expectedCalvingDate: isoDateSchema.optional(),
    responsible: optionalText(120),
    notes: optionalText(2000),
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== 'version' && field !== undefined),
    { message: 'No hay nada que cambiar.' },
  )
  .refine((value) => !(value.sireId != null && value.sireExternalRef != null), {
    path: ['sireExternalRef'],
    message: 'Indica el toro de la finca o la referencia externa, no ambos.',
  });
export type UpdatePregnancyInput = z.infer<typeof updatePregnancySchema>;

/** `POST /pregnancies/:id/void` (RN-11), solo ADMIN. */
export const voidPregnancySchema = z.object({
  reason: z
    .string({ message: 'Escribe el motivo.' })
    .trim()
    .min(3, { message: 'Escribe el motivo (mínimo 3 caracteres).' })
    .max(500, { message: 'Máximo 500 caracteres.' }),
});
export type VoidPregnancyInput = z.infer<typeof voidPregnancySchema>;

// ---------------------------------------------------------------------------------------------
// Parto (REP-04, CU-01)
// ---------------------------------------------------------------------------------------------

export const calfInputSchema = z
  .object({
    /** `id` del cliente de la cría viva (ADR-012 §1). */
    id: clientIdSchema.optional(),
    /** Sin valor, la API asigna el siguiente código de la finca dentro de la transacción. */
    code: animalCodeSchema.optional(),
    sex: z.enum(['FEMALE', 'MALE'], { message: 'Elige el sexo.' }),
    health: calfHealthSchema,
    birthWeightKg: weightKgSchema.optional(),
    /** Sin valor, la de la madre (REP-04 CA2). */
    breedId: uuidSchema.optional(),
    identifiers: z
      .array(z.object({ type: identifierTypeSchema, value: z.string().max(64) }))
      .max(5, { message: 'Máximo 5 identificadores.' })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.health !== CALF_HEALTH.STILLBORN) return;
    // Una cría muerta al nacer no crea animal (REP-04 CA4): no tiene código ni chapeta.
    for (const field of ['id', 'code', 'identifiers', 'breedId'] as const) {
      if (value[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Una cría muerta al nacer no se registra como animal.',
        });
      }
    }
  });
export type CalfInput = z.infer<typeof calfInputSchema>;

/** `POST /calvings` (REP-04). */
export const calvingSchema = z.object({
  /** `id` del cliente de la preñez que se crea cuando no había una abierta (ADR-012 §1). */
  id: clientIdSchema.optional(),
  damId: uuidSchema,
  /** La preñez abierta que se cierra; sin valor, la abierta de la hembra si la hay. */
  pregnancyId: uuidSchema.optional(),
  date: isoDateSchema,
  calvingType: calvingTypeSchema,
  notes: optionalText(2000),
  calves: z
    .array(calfInputSchema)
    .min(MIN_CALVES_PER_CALVING, { message: 'Un parto puede registrar de 1 a 3 crías.' })
    .max(MAX_CALVES_PER_CALVING, { message: 'Un parto puede registrar de 1 a 3 crías.' }),
});
export type CalvingInput = z.infer<typeof calvingSchema>;

// ---------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------

const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((text) => text.split(',').filter((item) => item !== ''))
    .pipe(z.array(z.enum(values)));

/** `GET /pregnancies`. */
export const listPregnanciesQuerySchema = z.object({
  outcome: csvList(['PENDING', 'CALVED', 'ABORTED', 'FAILED']).optional(),
  confirmed: z.enum(['true', 'false']).optional(),
  expectedFrom: isoDateSchema.optional(),
  expectedTo: isoDateSchema.optional(),
  damId: uuidSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type ListPregnanciesQuery = z.infer<typeof listPregnanciesQuerySchema>;

/** `GET /reports/births` (NAC-01). Sin fechas, el año en curso. */
export const birthsReportQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    path: ['to'],
    message: 'La fecha final no puede ser anterior a la inicial.',
  });
export type BirthsReportQuery = z.infer<typeof birthsReportQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------------------------

/** Una preñez, con lo que muestran la ficha (REP-05) y el listado. */
export type PregnancyView = {
  readonly id: string;
  readonly dam: AnimalRef;
  readonly serviceDate: IsoDate;
  /** La fecha de servicio no es real (palpación sin servicio, parto sin preñez, importación). */
  readonly serviceDateEstimated: boolean;
  readonly method: ServiceMethod;
  readonly sire: AnimalRef | null;
  readonly sireExternalRef: string | null;
  readonly responsible: string | null;
  readonly confirmedAt: IsoDate | null;
  readonly diagnosisResponsible: string | null;
  readonly expectedCalvingDate: IsoDate;
  /** El parto estimado se corrigió a mano: el recálculo por gestación no lo toca. */
  readonly expectedCalvingManual: boolean;
  readonly outcome: PregnancyOutcome;
  readonly outcomeDate: IsoDate | null;
  readonly calvingType: CalvingType | null;
  readonly stillbornCount: number;
  readonly isImported: boolean;
  readonly notes: string | null;
  /** Días de gestación cumplidos hoy; solo en la preñez abierta. */
  readonly gestationDays: number | null;
  /** Crías vivas registradas con este parto. */
  readonly calves: readonly AnimalRef[];
  readonly voided: { readonly at: string; readonly reason: string | null } | null;
  readonly version: number;
};

export type PregnancyWithWarnings = PregnancyView & { readonly warnings: readonly Warning[] };

export type PregnancyList = {
  readonly items: readonly PregnancyView[];
  readonly nextCursor: string | null;
};

/** Respuesta de `POST /calvings`. */
export type CalvingResult = {
  readonly pregnancy: PregnancyView;
  readonly calves: readonly (AnimalRef & { readonly sex: Sex })[];
  readonly warnings: readonly Warning[];
};

/** Intervalo entre partos de la ficha (REP-05 CA1, RN-38). */
export type CalvingIntervalView = {
  readonly lastDays: number | null;
  readonly averageDays: number | null;
};

/** Una cría viva en el reporte de nacimientos (NAC-01 CA2). */
export type BirthReportItem = {
  readonly calf: AnimalRef & { readonly sex: Sex };
  readonly birthDate: IsoDate;
  readonly dam: AnimalRef | null;
  readonly sire: AnimalRef | null;
  readonly sireExternalRef: string | null;
  readonly breed: string;
  readonly birthWeightKg: number | null;
  /** `null` si la cría no se registró con un parto (inventario, importación). */
  readonly birthCondition: BirthCondition | null;
};

/** Partos con crías muertas al nacer, que no son animales (REP-04 CA4). */
export type StillbirthReportItem = {
  readonly pregnancyId: string;
  readonly date: IsoDate;
  readonly dam: AnimalRef;
  readonly count: number;
};

/** `GET /reports/births` (NAC-01). */
export type BirthsReport = {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly totals: {
    readonly live: number;
    readonly males: number;
    readonly females: number;
    readonly weak: number;
    readonly stillborn: number;
  };
  readonly items: readonly BirthReportItem[];
  readonly stillbirths: readonly StillbirthReportItem[];
};
