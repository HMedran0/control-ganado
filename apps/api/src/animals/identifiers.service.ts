import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  uuidv7,
  type AddIdentifierInput,
  type IdentifierView,
  type IsoDate,
  type ReplaceIdentifierInput,
  type ReplaceIdentifierResult,
  type RetireIdentifierInput,
  type Warning,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { audit, isUniqueViolation, type Tx } from '../common/persistence.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { toIdentifierView } from './animal-detail.service.js';
import { checkIdentifier } from './identifier-rules.js';

/**
 * Identificadores de un animal (IDN-01, IDN-02).
 *
 * Nada se borra: un identificador perdido o dañado se **retira** (`retiredAt` + motivo) y sigue
 * visible en la ficha y en la búsqueda como «identificador anterior». El reemplazo retira el
 * anterior y crea el nuevo en la misma transacción, enlazados con `replacedById`.
 */
@Injectable()
export class IdentifiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async add(
    scope: FarmScope,
    animalId: string,
    input: AddIdentifierInput,
  ): Promise<IdentifierView & { readonly warnings: readonly Warning[] }> {
    const today = this.clock.today();
    const assignedAt = input.assignedAt ?? today;
    const at = this.clock.now();

    return this.write(async (tx) => {
      const animal = await editableAnimal(tx, scope, animalId);
      assertEventDate(assignedAt, today, fromPrismaDate(animal.birthDate), 'assignedAt');
      const checked = await checkIdentifier(tx, scope, {
        type: input.type,
        value: input.value,
        animalId,
        confirmReuse: input.confirmReuse,
      });
      const created = await tx.identifier.create({
        data: {
          id: uuidv7(),
          farmId: scope.farmId,
          animalId,
          type: checked.type,
          value: checked.value,
          assignedAt: toPrismaDate(assignedAt),
          createdAt: at,
        },
      });
      const view = toIdentifierView(created);
      await audit(tx, {
        scope,
        entity: 'Identifier',
        entityId: created.id,
        action: AUDIT_ACTION.CREATE,
        at,
        diff: { after: view },
      });
      return { ...view, warnings: checked.warnings };
    });
  }

  async replace(
    scope: FarmScope,
    identifierId: string,
    input: ReplaceIdentifierInput,
  ): Promise<ReplaceIdentifierResult> {
    const today = this.clock.today();
    const date = input.date;
    const at = this.clock.now();

    return this.write(async (tx) => {
      const current = await activeIdentifier(tx, scope, identifierId);
      const animal = await editableAnimal(tx, scope, current.animalId);
      assertEventDate(date, today, fromPrismaDate(animal.birthDate), 'date');
      if (date < fromPrismaDate(current.assignedAt)) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { date: ['La fecha es anterior a la asignación del identificador.'] },
        });
      }
      const checked = await checkIdentifier(tx, scope, {
        type: current.type,
        value: input.newValue,
        animalId: current.animalId,
        confirmReuse: input.confirmReuse,
      });
      if (checked.value === current.value) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { newValue: ['El valor nuevo es igual al anterior.'] },
        });
      }

      // El valor nuevo es distinto del anterior, así que el índice único de los activos no
      // choca: se crea el nuevo y se retira el anterior apuntando a él.
      const created = await tx.identifier.create({
        data: {
          id: uuidv7(),
          farmId: scope.farmId,
          animalId: current.animalId,
          type: current.type,
          value: checked.value,
          assignedAt: toPrismaDate(date),
          createdAt: at,
        },
      });
      const previous = await tx.identifier.update({
        where: { id: current.id },
        data: {
          retiredAt: toPrismaDate(date),
          retireReason: input.reason,
          replacedById: created.id,
        },
      });

      const previousView = toIdentifierView(previous);
      const currentView = toIdentifierView(created);
      await audit(tx, {
        scope,
        entity: 'Identifier',
        entityId: previous.id,
        action: AUDIT_ACTION.UPDATE,
        at,
        diff: { before: toIdentifierView(current), after: previousView },
      });
      await audit(tx, {
        scope,
        entity: 'Identifier',
        entityId: created.id,
        action: AUDIT_ACTION.CREATE,
        at,
        diff: { after: currentView },
      });
      return {
        id: created.id,
        previous: previousView,
        current: currentView,
        warnings: checked.warnings,
      };
    });
  }

  async retire(
    scope: FarmScope,
    identifierId: string,
    input: RetireIdentifierInput,
  ): Promise<IdentifierView> {
    const today = this.clock.today();
    const date = input.date;
    const at = this.clock.now();

    return this.write(async (tx) => {
      const current = await activeIdentifier(tx, scope, identifierId);
      const animal = await editableAnimal(tx, scope, current.animalId);
      assertEventDate(date, today, fromPrismaDate(animal.birthDate), 'date');
      if (date < fromPrismaDate(current.assignedAt)) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { date: ['La fecha es anterior a la asignación del identificador.'] },
        });
      }
      const retired = await tx.identifier.update({
        where: { id: current.id },
        data: { retiredAt: toPrismaDate(date), retireReason: input.reason },
      });
      const view = toIdentifierView(retired);
      await audit(tx, {
        scope,
        entity: 'Identifier',
        entityId: retired.id,
        action: AUDIT_ACTION.UPDATE,
        at,
        diff: { before: toIdentifierView(current), after: view },
      });
      return view;
    });
  }

  /** Transacción con la traducción del choque del índice único de los activos (RN-19). */
  private async write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('IDENTIFIER_TAKEN', {
          detail: 'Ese identificador acaba de asignarse a otro animal.',
          cause: error,
        });
      }
      throw error;
    }
  }
}

/** Animal de la finca que admite cambios: ni archivado ni con salida (RN-09). */
async function editableAnimal(tx: Tx, scope: FarmScope, animalId: string) {
  const animal = await tx.animal.findFirst({
    where: { id: animalId, farmId: scope.farmId },
    select: { id: true, birthDate: true, deletedAt: true, exitType: true },
  });
  if (animal === null) throw new DomainError('NOT_FOUND');
  if (animal.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');
  if (animal.exitType !== null) throw new DomainError('ANIMAL_EXITED');
  return animal;
}

/** Identificador activo de la finca. */
async function activeIdentifier(tx: Tx, scope: FarmScope, identifierId: string) {
  const identifier = await tx.identifier.findFirst({
    where: { id: identifierId, farmId: scope.farmId },
  });
  if (identifier === null) throw new DomainError('NOT_FOUND');
  if (identifier.retiredAt !== null) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'El identificador ya fue retirado.',
      fieldErrors: { id: ['El identificador ya fue retirado.'] },
    });
  }
  return identifier;
}

/** RN-14: ni futura ni anterior al nacimiento. */
function assertEventDate(date: IsoDate, today: IsoDate, birthDate: IsoDate, field: string): void {
  if (date > today) {
    throw new DomainError('DATE_IN_FUTURE', {
      fieldErrors: { [field]: ['La fecha no puede ser posterior a hoy.'] },
    });
  }
  if (date < birthDate) {
    throw new DomainError('DATE_BEFORE_BIRTH', {
      fieldErrors: { [field]: ['La fecha es anterior al nacimiento del animal.'] },
    });
  }
}
