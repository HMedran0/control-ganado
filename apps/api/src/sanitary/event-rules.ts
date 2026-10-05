import { DomainError, type IsoDate } from '@hato/shared';

import { assertNotBeforeBirth, assertNotFuture, fieldError } from '../animals/animal-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { fromPrismaDate } from '../infra/date-mapper.js';

/**
 * Reglas que comparten los eventos sanitarios y de peso de un animal (vacunación, tratamiento,
 * pesaje; M6): el animal es de la finca, está activo (RN-09) y la fecha no es futura ni anterior
 * a su nacimiento (RN-14).
 */

/** Lo que se lee del animal al registrarle un evento. */
export type EventAnimal = {
  readonly id: string;
  readonly code: string;
  readonly name: string | null;
  readonly sex: 'FEMALE' | 'MALE';
  readonly birthDate: IsoDate;
  readonly entryDate: IsoDate;
  readonly entryDateEstimated: boolean;
};

/**
 * Bloquea la fila del animal hasta el fin de la transacción y comprueba que admite eventos. Un
 * animal de otra finca no existe para quien pregunta: el error va en el campo, como en el parto.
 */
export async function lockEventAnimal(
  tx: Tx,
  scope: FarmScope,
  animalId: string,
  field = 'animalId',
): Promise<EventAnimal> {
  await tx.$queryRaw`
    SELECT id FROM animals WHERE id = ${animalId}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
  const animal = await tx.animal.findFirst({
    where: { id: animalId, farmId: scope.farmId },
    select: {
      id: true,
      code: true,
      name: true,
      sex: true,
      birthDate: true,
      entryDate: true,
      entryDateEstimated: true,
      deletedAt: true,
      exitType: true,
    },
  });
  if (animal === null) {
    throw fieldError('VALIDATION_FAILED', field, 'Ese animal no existe en esta finca.');
  }
  if (animal.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');
  if (animal.exitType !== null) throw new DomainError('ANIMAL_EXITED');
  return {
    id: animal.id,
    code: animal.code,
    name: animal.name,
    sex: animal.sex,
    birthDate: fromPrismaDate(animal.birthDate),
    entryDate: fromPrismaDate(animal.entryDate),
    entryDateEstimated: animal.entryDateEstimated,
  };
}

/** La fecha del evento no es futura ni anterior al nacimiento del animal (RN-14). */
export function assertEventDate(
  date: IsoDate,
  animal: EventAnimal,
  today: IsoDate,
  field = 'date',
): void {
  assertNotFuture(date, today, field);
  assertNotBeforeBirth(date, animal.birthDate, field);
}

/** Referencia al animal para las vistas. */
export function animalRef(animal: { id: string; code: string; name: string | null }) {
  return { id: animal.id, code: animal.code, name: animal.name };
}
