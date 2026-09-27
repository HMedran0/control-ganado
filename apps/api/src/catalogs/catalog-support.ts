import { AUDIT_ACTION, DomainError, type AuditAction } from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Piezas comunes de los catálogos (M3): auditoría dentro de la transacción, control de versión
 * y traducción de los choques de nombre.
 */

/** Cliente de Prisma dentro de una transacción interactiva. */
export type Tx = Prisma.TransactionClient;

/** Artículo y nombre de cada catálogo, para el mensaje de `CATALOG_NAME_TAKEN`. */
export const CATALOG_WHAT = {
  Breed: 'una raza',
  Vaccine: 'una vacuna',
  VaccinationCycle: 'un ciclo',
  Lot: 'un lote',
  Tag: 'una etiqueta',
} as const;

export type CatalogEntity = keyof typeof CATALOG_WHAT | 'Farm';

/** ¿Es el choque de un índice único? (P2002, incluidos los índices sobre `lower(name)`) */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Ejecuta una escritura de catálogo y traduce los errores de la base al catálogo de errores:
 *
 * - un nombre repetido (P2002) → `CATALOG_NAME_TAKEN`. La unicidad sin distinguir mayúsculas la
 *   garantiza la base (índice sobre `lower(name)`), no una consulta previa: así no hay carrera
 *   entre dos personas que crean «Brahman» a la vez;
 * - un `update` con `where: { version }` que no encontró la fila (P2025) → `VERSION_CONFLICT`:
 *   otra persona la cambió entre la lectura y la escritura.
 */
export async function catalogWrite<T>(
  entity: CatalogEntity,
  name: string | undefined,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error) && entity !== 'Farm') {
      throw new DomainError('CATALOG_NAME_TAKEN', {
        params: { what: CATALOG_WHAT[entity], name: name ?? '' },
        cause: error,
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new DomainError('VERSION_CONFLICT', { cause: error });
    }
    throw error;
  }
}

/**
 * Comprueba la versión antes de un `PATCH` (05, «Convenciones»).
 *
 * @throws {DomainError} `NOT_FOUND` si el registro no existe en esta finca (no se distingue de
 *   «es de otra finca», RN-21) y `VERSION_CONFLICT` si otra persona lo cambió.
 */
export function assertVersion<T extends { version: number }>(
  current: T | null,
  expected: number,
): T {
  if (current === null) throw new DomainError('NOT_FOUND');
  if (current.version !== expected) throw new DomainError('VERSION_CONFLICT');
  return current;
}

/**
 * Qué cambió entre dos versiones de un registro, campo por campo, para la auditoría.
 * Solo los campos pedidos; los valores iguales no aparecen.
 */
export function changesBetween<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): Prisma.InputJsonObject {
  const changed = fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  return {
    changed,
    before: Object.fromEntries(changed.map((field) => [field, toJson(before[field])])),
    after: Object.fromEntries(changed.map((field) => [field, toJson(after[field])])),
  };
}

function toJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Registra la escritura en `audit_logs` dentro de la misma transacción: si la escritura falla,
 * no queda auditoría de algo que no pasó, y si la auditoría falla, la escritura se deshace.
 */
export async function audit(
  tx: Tx,
  input: {
    readonly scope: FarmScope;
    readonly entity: CatalogEntity;
    readonly entityId: string;
    readonly action: AuditAction;
    readonly diff: Prisma.InputJsonObject;
    readonly at: Date;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      farmId: input.scope.farmId,
      userId: input.scope.userId,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      diff: input.diff,
      createdAt: input.at,
    },
  });
}

export { AUDIT_ACTION };

/** `?includeInactive=true` en los listados. */
export function parseIncludeInactive(value: string | undefined): boolean {
  return value === 'true';
}
