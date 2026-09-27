import { DomainError, type AuditAction } from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';
import type { FarmScope } from './farm-scope/farm-scope.types.js';

/**
 * Piezas comunes de las escrituras de negocio: auditoría dentro de la transacción, control de
 * versión y traducción de los errores de la base (M3, reutilizadas desde M4).
 */

/** Cliente de Prisma dentro de una transacción interactiva. */
export type Tx = Prisma.TransactionClient;

/** ¿Es el choque de un índice único? (P2002, incluidos los índices sobre `lower(name)`) */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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
    /** Nombre del modelo: `Animal`, `Identifier`, `Lot`… */
    readonly entity: string;
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
