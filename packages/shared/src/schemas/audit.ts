/**
 * Consulta de la auditoría (AUD-01 CA2, `GET /audit`). Solo ADMIN.
 *
 * La respuesta ya trae los identificadores resueltos a nombres (raza, lote, madre…) y **nunca**
 * trae montos: la API descarta los gastos, las ventas y los campos de precio antes de responder.
 * La web traduce los nombres de campo y las acciones a lenguaje de finca.
 */

import { z } from 'zod';

import type { AuditAction } from '../enums.js';
import { isoDateSchema } from './catalogs.js';

/** Entidades que se pueden consultar. Las económicas no están: sus diferencias son montos. */
export const AUDIT_ENTITY = {
  ANIMAL: 'Animal',
  IDENTIFIER: 'Identifier',
  BREED: 'Breed',
  LOT: 'Lot',
  TAG: 'Tag',
  VACCINE: 'Vaccine',
  VACCINATION_CYCLE: 'VaccinationCycle',
  FARM: 'Farm',
  USER: 'User',
} as const;
export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];

const uuidSchema = z.uuid({ message: 'El identificador no es válido.' });

export const auditQuerySchema = z
  .object({
    /** El animal y sus identificadores (la pestaña «Cambios» de la ficha). */
    animalId: uuidSchema.optional(),
    entity: z
      .enum(Object.values(AUDIT_ENTITY) as [AuditEntity, ...AuditEntity[]], {
        message: 'Entidad no válida.',
      })
      .optional(),
    entityId: uuidSchema.optional(),
    /** Días de negocio en la zona de la finca, ambos incluidos. */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.string().optional(),
    cursor: z.string().optional(),
  })
  .refine((value) => value.animalId === undefined || value.entity === undefined, {
    path: ['entity'],
    message: 'Usa animalId o entity, no ambos.',
  })
  .refine((value) => value.entityId === undefined || value.entity !== undefined, {
    path: ['entityId'],
    message: 'Indica la entidad del registro.',
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    path: ['to'],
    message: 'La fecha final debe ser igual o posterior a la inicial.',
  });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Valor de un campo en la auditoría, ya legible: los ids vienen como nombre o código. */
export type AuditValue = string | number | boolean | null | readonly string[];

export type AuditChangeView = {
  readonly field: string;
  readonly before: AuditValue;
  readonly after: AuditValue;
};

export type AuditEntryView = {
  readonly id: string;
  /** Instante en ISO 8601 (UTC). La web lo muestra en la hora de la finca. */
  readonly at: string;
  readonly action: AuditAction;
  readonly entity: AuditEntity;
  readonly entityId: string;
  /** Cómo nombrar el registro: código del animal, «Chapeta 123», nombre del lote… */
  readonly entityLabel: string | null;
  readonly user: { readonly id: string; readonly name: string } | null;
  readonly changes: readonly AuditChangeView[];
};

export type AuditPage = {
  readonly items: readonly AuditEntryView[];
  readonly nextCursor: string | null;
};
