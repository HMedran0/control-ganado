import { z } from 'zod';

import type { ImportIssue } from '../domain/animal-import.js';

/**
 * Importación del inventario (ANI-09): lo que viaja entre la web y la API. El archivo va en
 * `multipart/form-data`; estos son los campos que lo acompañan y las respuestas.
 */

/** Resultado de la simulación (`POST /imports/animals?dryRun=true`). No se guardó nada. */
export type AnimalImportPreview = {
  readonly fileName: string;
  readonly totalRows: number;
  /** Filas sin errores ni advertencias. */
  readonly validRows: number;
  /** Filas sin errores con alguna advertencia; también se importan. */
  readonly warningRows: number;
  readonly errorRows: number;
  /** Animales que se crearían al confirmar (`validRows + warningRows`). */
  readonly importable: number;
  readonly issues: readonly ImportIssue[];
  /** Razas que se crearían, con «Crear las razas que no existen». */
  readonly newBreeds: readonly string[];
  /** Si este mismo archivo (por su SHA-256) ya se importó en la finca, cuándo y cuántos creó. */
  readonly previousImport: {
    readonly importBatchId: string;
    readonly importedAt: string;
    readonly createdRows: number;
  } | null;
};

/** Resultado de confirmar (`POST /imports/animals`). */
export type AnimalImportResultView = {
  readonly importBatchId: string;
  readonly created: number;
  /** Filas que no entraron: con error o desmarcadas. */
  readonly skipped: number;
  /** `true` si la clave ya se había usado: es el lote de antes, no se importó otra vez. */
  readonly replayed: boolean;
};

const booleanField = z
  .enum(['true', 'false'], { message: 'Debe ser true o false.' })
  .optional()
  .transform((value) => value === 'true');

/** Campos del formulario de simulación. */
export const animalImportPreviewFieldsSchema = z.object({
  createMissingBreeds: booleanField,
});
export type AnimalImportPreviewFields = z.infer<typeof animalImportPreviewFieldsSchema>;

/** Campos del formulario de confirmación. */
export const animalImportConfirmFieldsSchema = animalImportPreviewFieldsSchema.extend({
  /** Clave de idempotencia que la web genera al elegir el archivo (ADR-011). */
  importKey: z.uuid({ message: 'Falta la clave de la importación.' }),
  /** Filas que la persona desmarcó en la simulación, separadas por coma («5,9»). */
  skipRows: z
    .string()
    .regex(/^(\d+(,\d+)*)?$/, { message: 'Lista de filas no válida.' })
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? [] : value.split(',').map(Number),
    ),
  /**
   * Animales que la simulación dijo que entrarían. Si al confirmar el resultado es otro (porque
   * alguien registró un animal con uno de esos códigos entretanto), no se importa nada.
   */
  expectedRows: z
    .string()
    .regex(/^\d+$/, { message: 'Debe ser un número.' })
    .optional()
    .transform((value) => (value === undefined ? undefined : Number(value))),
});
export type AnimalImportConfirmFields = z.infer<typeof animalImportConfirmFieldsSchema>;
