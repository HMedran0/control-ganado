/**
 * Esquemas de los pesos y la báscula (PES-01, PES-02, PES-04, PES-05; 05-api.md «Pesos y lotes»,
 * M6).
 */

import { z } from 'zod';

import type { IsoDate } from '../date.js';
import {
  SCALE_DATE_FORMAT,
  type ScaleColumnMapping,
  type ScaleImportPlan,
  type ScalePlanRow,
  type UnknownChip,
} from '../domain/scale-import.js';
import {
  IDENTIFIED_BY,
  SCALE_FILE_FORMAT,
  SCALE_UNIT,
  WEIGHT_METHOD,
  type IdentifiedBy,
  type ScaleFileFormat,
  type ScaleUnit,
  type WeightMethod,
  type WeightSource,
} from '../enums.js';
import type { SaleWeightProjection } from '../domain/weights.js';
import type { Warning } from '../errors.js';
import { weightKgSchema, type AnimalRef } from './animals.js';
import { isoDateSchema, versionSchema } from './catalogs.js';
import { clientIdSchema } from './offline.js';

const uuidSchema = z.uuid({ message: 'El identificador no es válido.' });

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

// ---------------------------------------------------------------------------------------------
// Pesaje individual (PES-01)
// ---------------------------------------------------------------------------------------------

export const weightMethodSchema = z.enum(
  Object.values(WEIGHT_METHOD) as [WeightMethod, ...WeightMethod[]],
  { message: 'Elige cómo se pesó.' },
);

/** Cómo se identificó al animal en el formulario: búsqueda, lector o QR (la importación es aparte). */
export const manualIdentifiedBySchema = z.enum(
  [IDENTIFIED_BY.SEARCH, IDENTIFIED_BY.RFID_READER, IDENTIFIED_BY.QR],
  { message: 'Indica cómo se identificó al animal.' },
);

/** `POST /weights` (PES-01). El peso es digitado (`weight_source = MANUAL`). */
export const createWeightSchema = z.object({
  id: clientIdSchema.optional(),
  animalId: uuidSchema,
  date: isoDateSchema,
  weightKg: weightKgSchema,
  method: weightMethodSchema,
  identifiedBy: manualIdentifiedBySchema.default(IDENTIFIED_BY.SEARCH),
  notes: optionalText(2000),
});
export type CreateWeightInput = z.infer<typeof createWeightSchema>;

/** Un pesaje. */
export type WeightView = {
  readonly id: string;
  readonly animalId: string;
  readonly weighedOn: IsoDate;
  readonly weightKg: number;
  readonly method: WeightMethod;
  readonly isBirthWeight: boolean;
  /** `null` si nadie identificó al animal (peso al nacer, peso inicial, seed). */
  readonly identifiedBy: IdentifiedBy | null;
  readonly weightSource: WeightSource;
  readonly scaleSerial: string | null;
  readonly notes: string | null;
  readonly workSessionId: string | null;
  readonly voided: { readonly at: string; readonly reason: string | null } | null;
  readonly createdAt: string;
  readonly createdById: string;
};

export type WeightWithWarnings = WeightView & { readonly warnings: readonly Warning[] };

/** Ganancias en kg/día, ya redondeadas a milésimas (ADR-015). */
export type WeightGainsView = {
  readonly lastTwo: number | null;
  readonly last90Days: number | null;
  readonly sinceBirth: number | null;
};

/** Resumen de peso del animal: ganancias y alertas de PES-05. */
export type WeightSummary = {
  readonly gains: WeightGainsView;
  /** Umbral de «Ganancia baja» de su categoría, en kg/día; `null` si no tiene. */
  readonly gainThreshold: number | null;
  readonly lowGain: boolean;
  readonly weightLoss: boolean;
  /** Cuánto bajó el último pesaje respecto al anterior, en %; positivo si bajó. */
  readonly lossPercent: number | null;
  /**
   * Peso objetivo de venta y su fecha estimada (PES-06 CA2); `null` sin objetivo para su
   * categoría, con la etiqueta «Reproductor», sin pesaje o sin ganancia de 90 días positiva.
   */
  readonly saleWeight: SaleWeightProjection | null;
};

/** `GET /animals/:id/weights` (PES-02, PES-05): la serie, de la más antigua a la más reciente. */
export type AnimalWeights = {
  readonly items: readonly WeightView[];
  readonly summary: WeightSummary;
};

// ---------------------------------------------------------------------------------------------
// Perfiles de báscula (PES-04)
// ---------------------------------------------------------------------------------------------

const headerListSchema = z.array(z.string().trim().min(1).max(60)).max(10);

export const scaleColumnMappingSchema: z.ZodType<ScaleColumnMapping> = z
  .object({
    eid: headerListSchema,
    visualId: headerListSchema,
    weight: headerListSchema.min(1, { message: 'Indica la columna del peso.' }),
    date: headerListSchema,
    time: headerListSchema,
    dateFormat: z.enum([SCALE_DATE_FORMAT.DMY, SCALE_DATE_FORMAT.MDY, SCALE_DATE_FORMAT.YMD]),
    unit: z.enum([SCALE_UNIT.KG, SCALE_UNIT.LB], { message: 'Elige kilos o libras.' }),
  })
  .refine((value) => value.eid.length > 0 || value.visualId.length > 0, {
    path: ['eid'],
    message: 'Indica la columna del chip o la del número visual.',
  });

export const scaleFileFormatSchema = z.enum(
  Object.values(SCALE_FILE_FORMAT) as [ScaleFileFormat, ...ScaleFileFormat[]],
);

const profileNameSchema = z
  .string({ message: 'Escribe un nombre para el perfil.' })
  .trim()
  .min(2, { message: 'Escribe un nombre para el perfil.' })
  .max(60, { message: 'Máximo 60 caracteres.' });

/** `POST /scale-profiles` (ADMIN). */
export const createScaleProfileSchema = z.object({
  id: clientIdSchema.optional(),
  name: profileNameSchema,
  fileFormat: scaleFileFormatSchema,
  columnMapping: scaleColumnMappingSchema,
});
export type CreateScaleProfileInput = z.infer<typeof createScaleProfileSchema>;

/** `PATCH /scale-profiles/:id` (ADMIN), con `version`. */
export const updateScaleProfileSchema = z.object({
  version: versionSchema,
  name: profileNameSchema.optional(),
  fileFormat: scaleFileFormatSchema.optional(),
  columnMapping: scaleColumnMappingSchema.optional(),
});
export type UpdateScaleProfileInput = z.infer<typeof updateScaleProfileSchema>;

/** `POST /scale-profiles/:templateKey/duplicate` (ADMIN). */
export const duplicateScaleTemplateSchema = z.object({
  id: clientIdSchema.optional(),
  name: profileNameSchema.optional(),
});
export type DuplicateScaleTemplateInput = z.infer<typeof duplicateScaleTemplateSchema>;

/**
 * Plantilla del sistema o perfil de la finca, juntos en `GET /scale-profiles`. En una plantilla,
 * `id` es su clave (`tru-test`) y `system` es `true`.
 */
export type ScaleProfileView = {
  readonly id: string;
  readonly name: string;
  readonly system: boolean;
  readonly templateKey: string | null;
  readonly version: number;
  readonly provisional: boolean;
  readonly fileFormat: ScaleFileFormat;
  readonly unit: ScaleUnit;
  readonly columnMapping: ScaleColumnMapping;
  /** El perfil nació de duplicar esta plantilla, en esta versión. */
  readonly sourceTemplateKey: string | null;
  readonly sourceTemplateVersion: number | null;
};

export type ScaleProfileList = {
  readonly items: readonly ScaleProfileView[];
  readonly nextCursor: null;
};

// ---------------------------------------------------------------------------------------------
// Importar la sesión de pesaje (PES-04)
// ---------------------------------------------------------------------------------------------

/** Chips desconocidos asociados a mano (PES-04 CA3). Llega como JSON en el formulario. */
export const scaleAssociationsSchema = z
  .array(
    z.object({
      chip: z.string().regex(/^\d{15}$/, { message: 'El chip debe tener 15 dígitos.' }),
      animalId: uuidSchema,
      saveChip: z.boolean().default(true),
    }),
  )
  .max(5000);

/**
 * Campos del formulario de la importación (`multipart/form-data`, además de `file`). Los textos
 * llegan como cadenas: la API los convierte con este esquema.
 */
export const weightImportFieldsSchema = z.object({
  /** Id de un perfil de la finca o clave de una plantilla del sistema (`tru-test`). */
  scaleProfileId: z.string().trim().min(1).max(60).optional(),
  /** Mapeo propuesto o ajustado, en JSON, cuando no hay perfil. */
  mapping: z.string().max(5000).optional(),
  /** Fecha de la sesión, para los archivos sin columna de fecha. Sin valor, hoy. */
  sessionDate: isoDateSchema.optional(),
  /** Asociaciones de chips desconocidos, en JSON. */
  associations: z
    .string()
    .max(256 * 1024)
    .optional(),
  /** Chips desconocidos que no se importan, separados por coma. */
  skip: z.string().max(100_000).optional(),
  /** Clave de la confirmación (ADR-011): la web la genera al elegir el archivo. */
  importKey: uuidSchema.optional(),
  /** Cuántos pesajes mostró la simulación (ADR-011). */
  expectedRows: z.coerce.number().int().min(0).optional(),
});
export type WeightImportFields = z.infer<typeof weightImportFieldsSchema>;

/** Aviso sobre un chip asociado a mano que no se puede guardar como RFID del animal. */
export type ChipAssociationNotice = {
  readonly chip: string;
  readonly animalId: string;
  readonly message: string;
};

/** Respuesta de la simulación (`POST /weights/import?dryRun=true`). */
export type WeightImportDryRun = {
  readonly fileName: string;
  readonly totalRows: number;
  readonly profile: { readonly id: string; readonly name: string; readonly system: boolean } | null;
  /** Mapeo con que se leyó el archivo (el del perfil o el propuesto). */
  readonly mapping: ScaleColumnMapping;
  /** Encabezado usado para cada columna. */
  readonly columns: {
    readonly eid: string | null;
    readonly visualId: string | null;
    readonly weight: string;
    readonly date: string | null;
    readonly time: string | null;
  };
  readonly unit: ScaleUnit;
  readonly rows: readonly ScalePlanRow[];
  readonly counts: ScaleImportPlan['counts'];
  readonly unknownChips: readonly UnknownChip[];
  readonly warnings: readonly Warning[];
  /** Pesajes que se guardarían. */
  readonly importable: number;
  readonly chipNotices: readonly ChipAssociationNotice[];
  /** El mismo archivo ya se importó (huella SHA-256). */
  readonly previousImport: { readonly importedAt: string; readonly created: number } | null;
};

/** Respuesta de la confirmación (`POST /weights/import`). */
export type WeightImportResult = {
  readonly importBatchId: string;
  readonly workSessionId: string;
  readonly created: number;
  /** Filas que no se guardaron (repetidas, con error, chips sin asociar o descartados). */
  readonly skipped: number;
  /** Chips desconocidos guardados como RFID de su animal. */
  readonly chipsSaved: number;
  readonly replayed: boolean;
};

/** Animal elegido para un chip desconocido, con su RFID activo (para el aviso de M6). */
export type ScaleAnimalOption = AnimalRef & { readonly rfid: string | null };
