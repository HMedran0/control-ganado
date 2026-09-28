import { DomainError, type ErrorCode, type ExitType } from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';

/** Animal que ya tiene un código (normalizado) dentro del conjunto donde se exige unicidad. */
export type CodeHolder = {
  readonly id: string;
  readonly code: string;
  readonly exitType: ExitType | null;
};

export type CodeCheck = {
  /** Código que se quiere usar, tal como se guardará. */
  readonly code: string;
  /** El propio animal (edición, reversión, restauración); `null` al crear. */
  readonly excludeAnimalId: string | null;
  /** `Farm.settings.codeReuse` (ANI-10). */
  readonly codeReuse: boolean;
  /**
   * ¿El animal quedará activo? Restaurar un archivado que había salido no lo activa: en una
   * finca que reutiliza números, su código no compite con los activos.
   */
  readonly willBeActive: boolean;
};

/**
 * Serializa, dentro de la transacción, las escrituras que usan el mismo código normalizado en la
 * finca. Sin el candado, dos registros simultáneos del mismo número en una finca sin reutilización
 * pasarían los dos la verificación (el índice único solo cubre a los activos, RN-31). Es un candado
 * de transacción: se libera solo al confirmar o deshacer.
 */
async function lockCode(tx: Tx, farmId: string, code: string): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${farmId}::text || ':' || hato_normalize_code(${code}::text), 0))`;
}

/**
 * Quién tiene ya el código en el conjunto donde la finca exige unicidad (RN-01, RN-30, RN-31):
 *
 * - con `codeReuse = false`, todos los animales **no archivados**, hayan salido o no;
 * - con `codeReuse = true`, solo los **activos**; y si el animal no quedará activo, nadie.
 *
 * Toma antes el candado del código, así que lo que devuelve sigue siendo cierto hasta que la
 * transacción termine.
 */
export async function findCodeHolder(
  tx: Tx,
  scope: FarmScope,
  check: CodeCheck,
): Promise<CodeHolder | null> {
  await lockCode(tx, scope.farmId, check.code);
  if (check.codeReuse && !check.willBeActive) return null;

  const onlyActive = check.codeReuse ? Prisma.sql`AND a.exit_type IS NULL` : Prisma.empty;
  const exclude =
    check.excludeAnimalId === null
      ? Prisma.empty
      : Prisma.sql`AND a.id <> ${check.excludeAnimalId}::uuid`;
  const rows = await tx.$queryRaw<{ id: string; code: string; exit_type: ExitType | null }[]>`
    SELECT a.id, a.code, a.exit_type::text AS exit_type
      FROM animals a
     WHERE a.farm_id = ${scope.farmId}::uuid
       AND hato_normalize_code(a.code) = hato_normalize_code(${check.code}::text)
       AND a.deleted_at IS NULL
       ${onlyActive}
       ${exclude}
     ORDER BY a.exit_type IS NULL DESC, a.created_at DESC
     LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, code: row.code, exitType: row.exit_type };
}

/**
 * Única verificación de disponibilidad del código: la usan el registro, la edición, la
 * reversión de una salida, la restauración y, en M4d, la importación.
 *
 * @throws {DomainError} `ANIMAL_CODE_TAKEN` (o el código que se indique, como
 *   `CODE_REASSIGNED` en la reversión) con el animal que lo tiene en `context`.
 */
export async function assertCodeAvailable(
  tx: Tx,
  scope: FarmScope,
  check: CodeCheck,
  errorCode: ErrorCode = 'ANIMAL_CODE_TAKEN',
): Promise<void> {
  const holder = await findCodeHolder(tx, scope, check);
  if (holder === null) return;
  throw new DomainError(errorCode, {
    params: { code: check.code, holder: holder.code },
    context: { animalId: holder.id, animalCode: holder.code },
  });
}
