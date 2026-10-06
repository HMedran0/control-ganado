import {
  DomainError,
  IDENTIFIER_RETIRE_REASON,
  ROLE,
  validateIdentifier,
  type IdentifierRetireReason,
  type IdentifierType,
  type Warning,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';

/** Identificador ya normalizado y validado, listo para guardar. */
export type CheckedIdentifier = {
  readonly type: IdentifierType;
  readonly value: string;
  readonly warnings: readonly Warning[];
};

/**
 * Valida un identificador nuevo para un animal (IDN-01, RN-19):
 *
 * - formato y normalización con `validateIdentifier` de shared (RFID de 15 dígitos, DIN sin
 *   espacios ni guiones);
 * - un valor **activo** es único por finca y tipo → `IDENTIFIER_TAKEN`, con el código del
 *   animal que lo tiene;
 * - un valor que ya se **retiró** de otro animal no se reasigna sin que un ADMIN lo confirme
 *   con `confirmReuse` → `IDENTIFIER_PREVIOUSLY_USED`. Si quien confirma no es ADMIN,
 *   `FORBIDDEN_ROLE`. Excepción (IDN-06 CA1): una chapeta que se liberó al registrar la salida de
 *   un animal (`EXITED`) se reutiliza sin confirmación.
 *
 * El índice único parcial de la base respalda la primera regla ante escrituras simultáneas.
 */
export async function checkIdentifier(
  tx: Tx,
  scope: FarmScope,
  input: {
    readonly type: IdentifierType;
    readonly value: string;
    readonly animalId: string | null;
    readonly confirmReuse?: boolean | undefined;
  },
): Promise<CheckedIdentifier> {
  const validation = validateIdentifier(input.type, input.value);
  if (validation.errorCode !== null) {
    throw new DomainError(validation.errorCode, {
      ...(validation.errorCode === 'VALIDATION_FAILED'
        ? { fieldErrors: { value: ['Escribe el identificador.'] } }
        : {}),
    });
  }
  const value = validation.normalized;

  const existing = await tx.identifier.findMany({
    where: { farmId: scope.farmId, type: input.type, value },
    select: {
      animalId: true,
      retiredAt: true,
      retireReason: true,
      animal: { select: { code: true } },
    },
  });
  assertIdentifierFree(scope, {
    value,
    animalId: input.animalId,
    confirmReuse: input.confirmReuse,
    existing: existing.map((identifier) => ({
      animalId: identifier.animalId,
      animalCode: identifier.animal.code,
      retired: identifier.retiredAt !== null,
      retireReason: identifier.retireReason,
    })),
  });

  return { type: input.type, value, warnings: validation.warnings };
}

/** Un uso, activo o retirado, de un valor de identificador en la finca. */
export type IdentifierUse = {
  readonly animalId: string;
  readonly animalCode: string;
  readonly retired: boolean;
  readonly retireReason: IdentifierRetireReason | null;
};

/**
 * Las reglas de `checkIdentifier` sobre los usos que ya tiene el valor: activo en otro animal →
 * `IDENTIFIER_TAKEN`; retirado de otro animal sin la confirmación de un ADMIN →
 * `IDENTIFIER_PREVIOUSLY_USED` o `FORBIDDEN_ROLE`, salvo la chapeta liberada por una salida.
 */
export function assertIdentifierFree(
  scope: FarmScope,
  input: {
    readonly value: string;
    readonly animalId: string | null;
    readonly confirmReuse?: boolean | undefined;
    readonly existing: readonly IdentifierUse[];
  },
): void {
  const { value } = input;
  const active = input.existing.find((use) => !use.retired);
  if (active !== undefined) {
    throw new DomainError('IDENTIFIER_TAKEN', {
      params: { value, code: active.animalCode },
      context: { animalId: active.animalId, animalCode: active.animalCode },
    });
  }

  const previousOwner = input.existing.find(
    (use) => use.animalId !== input.animalId && use.retireReason !== IDENTIFIER_RETIRE_REASON.EXITED,
  );
  if (previousOwner !== undefined) {
    if (input.confirmReuse !== true) {
      throw new DomainError('IDENTIFIER_PREVIOUSLY_USED', {
        params: { value, code: previousOwner.animalCode },
        context: { animalId: previousOwner.animalId, animalCode: previousOwner.animalCode },
      });
    }
    if (scope.role !== ROLE.ADMIN) {
      throw new DomainError('FORBIDDEN_ROLE', {
        detail:
          'Solo un administrador puede reasignar un identificador que ya perteneció a otro animal.',
      });
    }
  }
}

/**
 * Los usos de muchos identificadores ya normalizados en una consulta (la importación, ANI-09),
 * por `${type}:${value}`, para pasarlos a `assertIdentifierFree`.
 */
export async function findIdentifierUses(
  tx: Tx,
  scope: FarmScope,
  identifiers: readonly { readonly type: IdentifierType; readonly value: string }[],
): Promise<Map<string, IdentifierUse[]>> {
  const uses = new Map<string, IdentifierUse[]>();
  if (identifiers.length === 0) return uses;
  const values = identifiers.map((item) => item.value);
  const rows = await tx.$queryRaw<
    {
      type: IdentifierType;
      value: string;
      animal_id: string;
      code: string;
      retired: boolean;
      retire_reason: IdentifierRetireReason | null;
    }[]
  >`
    SELECT i.type::text AS type, i.value, i.animal_id, a.code,
           i.retired_at IS NOT NULL AS retired, i.retire_reason::text AS retire_reason
      FROM identifiers i
      JOIN animals a ON a.id = i.animal_id
     WHERE i.farm_id = ${scope.farmId}::uuid
       AND i.value = ANY(${values}::text[])
       AND (i.type::text, i.value) IN (
             SELECT * FROM unnest(${identifiers.map((item) => item.type)}::text[],
                                  ${values}::text[]))`;
  for (const row of rows) {
    const key = identifierKey(row.type, row.value);
    const list = uses.get(key) ?? [];
    list.push({
      animalId: row.animal_id,
      animalCode: row.code,
      retired: row.retired,
      retireReason: row.retire_reason,
    });
    uses.set(key, list);
  }
  return uses;
}

export const identifierKey = (type: IdentifierType, value: string): string => `${type}:${value}`;
