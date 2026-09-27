import {
  DomainError,
  ROLE,
  validateIdentifier,
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
 *   `FORBIDDEN_ROLE`.
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
    select: { animalId: true, retiredAt: true, animal: { select: { code: true } } },
  });

  const active = existing.find((identifier) => identifier.retiredAt === null);
  if (active !== undefined) {
    throw new DomainError('IDENTIFIER_TAKEN', { params: { value, code: active.animal.code } });
  }

  const previousOwner = existing.find((identifier) => identifier.animalId !== input.animalId);
  if (previousOwner !== undefined) {
    if (input.confirmReuse !== true) {
      throw new DomainError('IDENTIFIER_PREVIOUSLY_USED', {
        params: { value, code: previousOwner.animal.code },
      });
    }
    if (scope.role !== ROLE.ADMIN) {
      throw new DomainError('FORBIDDEN_ROLE', {
        detail:
          'Solo un administrador puede reasignar un identificador que ya perteneció a otro animal.',
      });
    }
  }

  return { type: input.type, value, warnings: validation.warnings };
}
