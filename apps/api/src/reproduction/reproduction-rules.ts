import { DomainError, PREGNANCY_OUTCOME, SEX, type IsoDate } from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { isUniqueViolation, type Tx } from '../common/persistence.js';
import { fromPrismaDate } from '../infra/date-mapper.js';
import { fieldError } from '../animals/animal-rules.js';
import { pregnancyInclude, type PregnancyRow } from './pregnancy-views.js';

/** Reglas que comparten el servicio, la palpación, el aborto y el parto. */

/**
 * Bloquea la fila de la hembra hasta el fin de la transacción y comprueba que admite eventos
 * reproductivos: existe en la finca, es hembra (RN-02), no está archivada ni salió (RN-09).
 * El candado serializa dos registros simultáneos sobre la misma hembra.
 */
export async function lockDam(tx: Tx, scope: FarmScope, damId: string, field = 'damId') {
  await tx.$queryRaw`
    SELECT id FROM animals WHERE id = ${damId}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
  const dam = await tx.animal.findFirst({
    where: { id: damId, farmId: scope.farmId },
    select: {
      id: true,
      code: true,
      sex: true,
      birthDate: true,
      breedId: true,
      lotId: true,
      deletedAt: true,
      exitType: true,
      breed: { select: { gestationDays: true } },
    },
  });
  if (dam === null)
    throw fieldError('VALIDATION_FAILED', field, 'Esa hembra no existe en esta finca.');
  if (dam.sex !== SEX.FEMALE) {
    throw new DomainError('SEX_NOT_ALLOWED', {
      detail: `Esta acción solo aplica a hembras; ${dam.code} es macho.`,
      fieldErrors: { [field]: ['Esta acción solo aplica a hembras.'] },
    });
  }
  if (dam.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');
  if (dam.exitType !== null) throw new DomainError('ANIMAL_EXITED');
  return dam;
}

export type LockedDam = Awaited<ReturnType<typeof lockDam>>;

/** El toro de la finca: existe, no está archivado y es macho (RN-02). */
export async function assertSire(tx: Tx, scope: FarmScope, sireId: string): Promise<void> {
  const sire = await tx.animal.findFirst({
    where: { id: sireId, farmId: scope.farmId, deletedAt: null },
    select: { code: true, sex: true },
  });
  if (sire === null) {
    throw fieldError('VALIDATION_FAILED', 'sireId', 'Ese toro no existe en esta finca.');
  }
  if (sire.sex !== SEX.MALE) {
    throw new DomainError('SEX_NOT_ALLOWED', {
      detail: `El padre debe ser macho; ${sire.code} es hembra.`,
      fieldErrors: { sireId: ['El padre debe ser macho.'] },
    });
  }
}

/** La preñez de la finca, bloqueada hasta el fin de la transacción. */
export async function lockPregnancy(tx: Tx, scope: FarmScope, id: string): Promise<PregnancyRow> {
  await tx.$queryRaw`
    SELECT id FROM pregnancies WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
  const pregnancy = await tx.pregnancy.findFirst({
    where: { id, farmId: scope.farmId },
    include: pregnancyInclude,
  });
  if (pregnancy === null) throw new DomainError('NOT_FOUND');
  return pregnancy;
}

/** Palpación, aborto y parto cierran o confirman una preñez abierta (RN-03). */
export function assertOpen(pregnancy: PregnancyRow): void {
  if (pregnancy.voidedAt !== null || pregnancy.outcome !== PREGNANCY_OUTCOME.PENDING) {
    throw new DomainError('PREGNANCY_NOT_OPEN', {
      detail: 'Esta preñez ya está cerrada o anulada.',
    });
  }
}

/** La preñez abierta de la hembra, si tiene (RN-03: a lo sumo una). */
export function openPregnancyOf(tx: Tx, scope: FarmScope, damId: string) {
  return tx.pregnancy.findFirst({
    where: {
      farmId: scope.farmId,
      damId,
      outcome: PREGNANCY_OUTCOME.PENDING,
      voidedAt: null,
    },
    include: pregnancyInclude,
  });
}

/** `PREGNANCY_ALREADY_OPEN` con la preñez abierta en `context`, para ofrecer ir a cerrarla. */
export function alreadyOpen(pregnancyId: string): DomainError {
  return new DomainError('PREGNANCY_ALREADY_OPEN', { context: { pregnancyId } });
}

/**
 * El índice único parcial de las preñeces abiertas (RN-03) respalda el candado de la hembra: si
 * aun así dos servicios simultáneos llegan a la base, el segundo es `PREGNANCY_ALREADY_OPEN`.
 */
export function translateOpenViolation(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new DomainError('PREGNANCY_ALREADY_OPEN', { cause: error });
  }
  throw error;
}

/** Un evento de la preñez no puede ser anterior a su servicio. */
export function assertNotBeforeService(
  date: IsoDate,
  serviceDate: Date,
  field: string,
  message: string,
): void {
  if (date < fromPrismaDate(serviceDate)) throw fieldError('VALIDATION_FAILED', field, message);
}

/** Si quien palpó es usuario, tiene que ser de esta finca. */
export async function assertFarmUser(tx: Tx, scope: FarmScope, userId: string): Promise<void> {
  const membership = await tx.membership.findFirst({
    where: { farmId: scope.farmId, userId },
    select: { id: true },
  });
  if (membership === null) {
    throw fieldError('VALIDATION_FAILED', 'responsibleUserId', 'Ese usuario no es de esta finca.');
  }
}
