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
 * `findCodeHolder` para muchos códigos a la vez (la importación, ANI-09): mismo conjunto, mismo
 * orden de preferencia y mismos candados, en dos consultas en lugar de dos por código.
 *
 * Los candados se toman en un orden determinista —código normalizado ascendente, por bytes— para
 * no cruzarse con otra escritura que tome varios: dos transacciones que piden los mismos candados
 * en el mismo orden no se bloquean en círculo. Un alta individual toma uno solo.
 *
 * @returns el que tiene cada código, por código normalizado (`hato_normalize_code`).
 */
export async function findCodeHolders(
  tx: Tx,
  scope: FarmScope,
  check: { readonly codes: readonly string[]; readonly codeReuse: boolean },
): Promise<Map<string, CodeHolder>> {
  const holders = new Map<string, CodeHolder>();
  if (check.codes.length === 0) return holders;
  const codes = [...check.codes];

  await tx.$queryRaw`
    SELECT count(pg_advisory_xact_lock(hashtextextended(${scope.farmId}::text || ':' || s.key, 0)))
      FROM (SELECT DISTINCT hato_normalize_code(c) COLLATE "C" AS key
              FROM unnest(${codes}::text[]) AS c
             ORDER BY 1) AS s`;

  const onlyActive = check.codeReuse ? Prisma.sql`AND a.exit_type IS NULL` : Prisma.empty;
  const rows = await tx.$queryRaw<
    { id: string; code: string; exit_type: ExitType | null; key: string }[]
  >`
    SELECT a.id, a.code, a.exit_type::text AS exit_type, hato_normalize_code(a.code) AS key
      FROM animals a
     WHERE a.farm_id = ${scope.farmId}::uuid
       AND hato_normalize_code(a.code) = ANY(
             SELECT hato_normalize_code(c) FROM unnest(${codes}::text[]) AS c)
       AND a.deleted_at IS NULL
       ${onlyActive}
     ORDER BY a.exit_type IS NULL DESC, a.created_at DESC`;
  for (const row of rows) {
    if (holders.has(row.key)) continue;
    holders.set(row.key, { id: row.id, code: row.code, exitType: row.exit_type });
  }
  return holders;
}

/** El error de `assertCodeAvailable` para un código que ya tiene otro animal. */
export function codeTakenError(
  code: string,
  holder: CodeHolder,
  errorCode: ErrorCode = 'ANIMAL_CODE_TAKEN',
): DomainError {
  return new DomainError(errorCode, {
    params: { code, holder: holder.code },
    context: { animalId: holder.id, animalCode: holder.code },
  });
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
  throw codeTakenError(check.code, holder, errorCode);
}
