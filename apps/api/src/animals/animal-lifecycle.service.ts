import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  EXIT_TYPE,
  IDENTIFIER_RETIRE_REASON,
  exitNeedsWithdrawalConfirmation,
  formatDate,
  isReleasedOnExit,
  uuidv7,
  warning,
  withdrawalUntilOf,
  type AnimalDetailWithWarnings,
  type ArchiveAnimalInput,
  type ExitAnimalInput,
  type IdentifierRetireReason,
  type IsoDate,
  type RestoreAnimalInput,
  type RevertExitInput,
  type Warning,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { audit, type Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, fromPrismaDateOrNull, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AnimalDetailService, toIdentifierView } from './animal-detail.service.js';
import { assertNotBeforeBirth, assertNotFuture, userOf } from './animal-rules.js';
import { assertCodeAvailable, findCodeHolder } from './code-availability.js';
import { FarmContextService } from './farm-context.service.js';

type AnimalRow = Prisma.AnimalGetPayload<object>;
type IdentifierRow = Prisma.IdentifierGetPayload<object>;

/** Identificador retirado que no se pudo reactivar: otro animal activo lo tiene. */
type Blocked = {
  readonly identifier: IdentifierRow;
  readonly holderId: string;
  holderCode: string;
};

/**
 * Salida, reversión, archivo y restauración de un animal (ANI-03, ANI-04, IDN-06). Solo ADMIN: el
 * controlador lo exige con `@Roles`.
 *
 * Cada caso de uso es una transacción que empieza bloqueando la fila del animal, así que dos
 * salidas simultáneas del mismo animal no pueden pasar las dos. El código se verifica siempre con
 * `assertCodeAvailable` (RN-01, RN-30, RN-31).
 */
@Injectable()
export class AnimalLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly farmContext: FarmContextService,
    private readonly details: AnimalDetailService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Salida (ANI-04, IDN-06)
  // -------------------------------------------------------------------------------------------

  async exit(
    scope: FarmScope,
    id: string,
    input: ExitAnimalInput,
  ): Promise<AnimalDetailWithWarnings> {
    const context = await this.farmContext.load(scope);
    const userId = userOf(scope);
    const at = this.clock.now();
    const date = input.date;
    assertNotFuture(date, context.today, 'date');

    const amount = input.sale?.amount;
    if (input.type === EXIT_TYPE.SALE && amount === undefined) {
      throw new DomainError('SALE_AMOUNT_REQUIRED', {
        fieldErrors: { 'sale.amount': ['Indica el precio de venta.'] },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const animal = await lockAnimal(tx, scope, id);
      if (animal.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');
      if (animal.exitType !== null) {
        throw new DomainError('ANIMAL_EXITED', { detail: 'El animal ya salió de la finca.' });
      }
      assertNotBeforeBirth(date, fromPrismaDate(animal.birthDate), 'date');
      if (date < fromPrismaDate(animal.entryDate)) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { date: ['La salida no puede ser anterior al ingreso a la finca.'] },
        });
      }

      // RN-22: vender o sacrificar un animal en retiro exige confirmarlo.
      const treatments = await tx.treatmentRecord.findMany({
        where: { farmId: scope.farmId, animalId: id },
        select: { withdrawalUntil: true, voidedAt: true },
      });
      const withdrawalUntil = withdrawalUntilOf(
        treatments.map((treatment) => ({
          withdrawalUntil: fromPrismaDateOrNull(treatment.withdrawalUntil),
          voided: treatment.voidedAt !== null,
        })),
      );
      const needsConfirmation = exitNeedsWithdrawalConfirmation({
        type: input.type,
        date,
        withdrawalUntil,
      });
      if (needsConfirmation && input.confirmWithdrawal !== true) {
        throw new DomainError('WITHDRAWAL_ACTIVE', {
          params: { date: formatDate(withdrawalUntil as IsoDate) },
          context: { withdrawalUntil: withdrawalUntil as IsoDate },
        });
      }

      await tx.animal.update({
        where: { id },
        data: {
          exitType: input.type,
          exitDate: toPrismaDate(date),
          exitReason: input.reason ?? null,
          forSale: false,
          version: { increment: 1 },
          updatedById: userId,
          updatedAt: at,
        },
      });

      let saleId: string | null = null;
      if (input.type === EXIT_TYPE.SALE && amount !== undefined) {
        saleId = uuidv7();
        await tx.sale.create({
          data: {
            id: saleId,
            farmId: scope.farmId,
            animalId: id,
            soldOn: toPrismaDate(date),
            amount: new Prisma.Decimal(amount),
            buyer: input.sale?.buyer ?? null,
            createdById: userId,
            createdAt: at,
          },
        });
        await audit(tx, {
          scope,
          entity: 'Sale',
          entityId: saleId,
          action: AUDIT_ACTION.CREATE,
          at,
          diff: {
            after: {
              animalId: id,
              soldOn: date,
              amount: new Prisma.Decimal(amount).toFixed(2),
              buyer: input.sale?.buyer ?? null,
            },
          },
        });
      }

      // IDN-06: con numeración reutilizable, las chapetas quedan libres para otro animal.
      const released = await this.retireIdentifiers(tx, scope, {
        animalId: id,
        date,
        at,
        reason: IDENTIFIER_RETIRE_REASON.EXITED,
        which: (identifier) =>
          isReleasedOnExit({ codeReuse: context.settings.codeReuse, type: identifier.type }),
      });

      await audit(tx, {
        scope,
        entity: 'Animal',
        entityId: id,
        action: AUDIT_ACTION.EXIT,
        at,
        diff: {
          after: {
            exitType: input.type,
            exitDate: date,
            exitReason: input.reason ?? null,
            sale: saleId !== null,
            withdrawalConfirmed: needsConfirmation,
            releasedIdentifiers: released.map(label),
          },
        },
      });
    });

    return { ...(await this.details.detail(scope, id, context)), warnings: [] };
  }

  /**
   * Revierte una salida registrada por error (ANI-04 CA5): anula la venta, reactiva las chapetas
   * liberadas que sigan libres y avisa de las demás.
   *
   * Solo el **código** bloquea: si ya lo tiene otro animal activo, responde `CODE_REASSIGNED` con
   * ese animal en `context` (IDN-06 CA3) y se reintenta con `newCode`. Una chapeta que tomó otro
   * animal no impide revertir: queda retirada y llega como advertencia `IDENTIFIER_NOT_RESTORED`.
   */
  async revertExit(
    scope: FarmScope,
    id: string,
    input: RevertExitInput,
  ): Promise<AnimalDetailWithWarnings> {
    const context = await this.farmContext.load(scope);
    const userId = userOf(scope);
    const at = this.clock.now();
    const codeReuse = context.settings.codeReuse;

    const warnings = await this.prisma.$transaction(async (tx) => {
      const animal = await lockAnimal(tx, scope, id);
      if (animal.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');
      if (animal.exitType === null) {
        throw new DomainError('VALIDATION_FAILED', {
          detail: 'El animal no tiene una salida registrada.',
        });
      }

      const released = await tx.identifier.findMany({
        where: {
          farmId: scope.farmId,
          animalId: id,
          retireReason: IDENTIFIER_RETIRE_REASON.EXITED,
        },
        orderBy: { assignedAt: 'asc' },
      });
      const { free, blocked } = await splitByAvailability(tx, scope, id, released);

      if (input.newCode === undefined) {
        const holder = await findCodeHolder(tx, scope, {
          code: animal.code,
          excludeAnimalId: id,
          codeReuse,
          willBeActive: true,
        });
        if (holder !== null) {
          throw new DomainError('CODE_REASSIGNED', {
            params: { code: animal.code, holder: holder.code },
            context: { animalId: holder.id, animalCode: holder.code },
          });
        }
        // Una chapeta ocupada no bloquea: queda retirada y se avisa (IDN-06 CA3).
      } else {
        await assertCodeAvailable(tx, scope, {
          code: input.newCode,
          excludeAnimalId: id,
          codeReuse,
          willBeActive: true,
        });
      }

      const sale = await tx.sale.findFirst({
        where: { farmId: scope.farmId, animalId: id, voidedAt: null },
      });
      if (sale !== null) {
        await tx.sale.update({
          where: { id: sale.id },
          data: { voidedAt: at, voidReason: 'Se revirtió la salida del animal.' },
        });
        await audit(tx, {
          scope,
          entity: 'Sale',
          entityId: sale.id,
          action: AUDIT_ACTION.VOID,
          at,
          diff: { before: { amount: sale.amount.toFixed(2) } },
        });
      }

      const code = input.newCode ?? animal.code;
      await tx.animal.update({
        where: { id },
        data: {
          code,
          exitType: null,
          exitDate: null,
          exitReason: null,
          version: { increment: 1 },
          updatedById: userId,
          updatedAt: at,
        },
      });
      await this.reactivate(tx, scope, free, at);

      await audit(tx, {
        scope,
        entity: 'Animal',
        entityId: id,
        action: AUDIT_ACTION.REVERT_EXIT,
        at,
        diff: {
          before: {
            code: animal.code,
            exitType: animal.exitType,
            exitDate: fromPrismaDate(animal.exitDate ?? animal.birthDate),
            exitReason: animal.exitReason,
          },
          after: {
            code,
            restoredIdentifiers: free.map(label),
            notRestored: blocked.map((item) => label(item.identifier)),
          },
        },
      });
      return notRestoredWarnings(blocked);
    });

    return { ...(await this.details.detail(scope, id, context)), warnings };
  }

  // -------------------------------------------------------------------------------------------
  // Archivo y restauración (ANI-03)
  // -------------------------------------------------------------------------------------------

  /**
   * Archiva el animal (eliminación lógica, RN-11). Retira **todos** sus identificadores activos,
   * DIN y RFID incluidos, con motivo `ARCHIVED`: un registro duplicado por error no debe seguir
   * ocupando el DIN del animal real. Es la única excepción de RN-32.
   */
  async archive(
    scope: FarmScope,
    id: string,
    input: ArchiveAnimalInput,
  ): Promise<AnimalDetailWithWarnings> {
    const context = await this.farmContext.load(scope);
    const userId = userOf(scope);
    const at = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      const animal = await lockAnimal(tx, scope, id);
      if (animal.deletedAt !== null) throw new DomainError('ANIMAL_ARCHIVED');

      const retired = await this.retireIdentifiers(tx, scope, {
        animalId: id,
        date: context.today,
        at,
        reason: IDENTIFIER_RETIRE_REASON.ARCHIVED,
        which: () => true,
      });
      await tx.animal.update({
        where: { id },
        data: {
          deletedAt: at,
          deletedReason: input.reason,
          forSale: false,
          version: { increment: 1 },
          updatedById: userId,
          updatedAt: at,
        },
      });
      await audit(tx, {
        scope,
        entity: 'Animal',
        entityId: id,
        action: AUDIT_ACTION.ARCHIVE,
        at,
        diff: { after: { reason: input.reason, retiredIdentifiers: retired.map(label) } },
      });
    });

    return { ...(await this.details.detail(scope, id, context)), warnings: [] };
  }

  /**
   * Restaura un archivado (ANI-03 CA2). Si su código ya lo tiene otro animal, `ANIMAL_CODE_TAKEN`
   * con ese animal en `context`; se reintenta con `newCode`. Reactiva los identificadores que se
   * retiraron al archivarlo si siguen libres, y avisa de los demás.
   */
  async restore(
    scope: FarmScope,
    id: string,
    input: RestoreAnimalInput,
  ): Promise<AnimalDetailWithWarnings> {
    const context = await this.farmContext.load(scope);
    const userId = userOf(scope);
    const at = this.clock.now();

    const warnings = await this.prisma.$transaction(async (tx) => {
      const animal = await lockAnimal(tx, scope, id);
      if (animal.deletedAt === null) {
        throw new DomainError('VALIDATION_FAILED', { detail: 'El animal no está archivado.' });
      }

      const code = input.newCode ?? animal.code;
      await assertCodeAvailable(tx, scope, {
        code,
        excludeAnimalId: id,
        codeReuse: context.settings.codeReuse,
        willBeActive: animal.exitType === null,
      });

      const archivedIdentifiers = await tx.identifier.findMany({
        where: {
          farmId: scope.farmId,
          animalId: id,
          retireReason: IDENTIFIER_RETIRE_REASON.ARCHIVED,
        },
        orderBy: { assignedAt: 'asc' },
      });
      const { free, blocked } = await splitByAvailability(tx, scope, id, archivedIdentifiers);

      await tx.animal.update({
        where: { id },
        data: {
          code,
          deletedAt: null,
          deletedReason: null,
          version: { increment: 1 },
          updatedById: userId,
          updatedAt: at,
        },
      });
      await this.reactivate(tx, scope, free, at);

      await audit(tx, {
        scope,
        entity: 'Animal',
        entityId: id,
        action: AUDIT_ACTION.RESTORE,
        at,
        diff: {
          before: { code: animal.code, reason: animal.deletedReason },
          after: {
            code,
            restoredIdentifiers: free.map(label),
            notRestored: blocked.map((item) => label(item.identifier)),
          },
        },
      });
      return notRestoredWarnings(blocked);
    });

    return { ...(await this.details.detail(scope, id, context)), warnings };
  }

  // -------------------------------------------------------------------------------------------
  // Identificadores
  // -------------------------------------------------------------------------------------------

  /** Retira los identificadores activos elegidos y deja su auditoría. */
  private async retireIdentifiers(
    tx: Tx,
    scope: FarmScope,
    input: {
      animalId: string;
      date: IsoDate;
      at: Date;
      reason: IdentifierRetireReason;
      which: (identifier: IdentifierRow) => boolean;
    },
  ): Promise<IdentifierRow[]> {
    const active = await tx.identifier.findMany({
      where: { farmId: scope.farmId, animalId: input.animalId, retiredAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    const chosen = active.filter(input.which);
    const retired: IdentifierRow[] = [];
    for (const identifier of chosen) {
      // Nunca antes de su asignación, aunque la salida se registre con una fecha anterior.
      const assignedAt = fromPrismaDate(identifier.assignedAt);
      const retiredOn = input.date < assignedAt ? assignedAt : input.date;
      const updated = await tx.identifier.update({
        where: { id: identifier.id },
        data: { retiredAt: toPrismaDate(retiredOn), retireReason: input.reason },
      });
      await audit(tx, {
        scope,
        entity: 'Identifier',
        entityId: identifier.id,
        action: AUDIT_ACTION.UPDATE,
        at: input.at,
        diff: { before: toIdentifierView(identifier), after: toIdentifierView(updated) },
      });
      retired.push(updated);
    }
    return retired;
  }

  /** Vuelve a activar identificadores retirados por el sistema, con su auditoría. */
  private async reactivate(
    tx: Tx,
    scope: FarmScope,
    identifiers: readonly IdentifierRow[],
    at: Date,
  ): Promise<void> {
    for (const identifier of identifiers) {
      const updated = await tx.identifier.update({
        where: { id: identifier.id },
        data: { retiredAt: null, retireReason: null },
      });
      await audit(tx, {
        scope,
        entity: 'Identifier',
        entityId: identifier.id,
        action: AUDIT_ACTION.UPDATE,
        at,
        diff: { before: toIdentifierView(identifier), after: toIdentifierView(updated) },
      });
    }
  }
}

/** Bloquea la fila del animal hasta el fin de la transacción y la devuelve. */
async function lockAnimal(tx: Tx, scope: FarmScope, id: string): Promise<AnimalRow> {
  await tx.$queryRaw`
    SELECT id FROM animals WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
  const animal = await tx.animal.findFirst({ where: { id, farmId: scope.farmId } });
  if (animal === null) throw new DomainError('NOT_FOUND');
  return animal;
}

/**
 * Separa los identificadores que se pueden reactivar de los que ya tiene otro animal activo con
 * el mismo tipo y valor (RN-19). Solo cuenta un valor **activo**: si otro lo tuvo y lo soltó,
 * vuelve a estar libre.
 */
async function splitByAvailability(
  tx: Tx,
  scope: FarmScope,
  animalId: string,
  identifiers: readonly IdentifierRow[],
): Promise<{ free: IdentifierRow[]; blocked: Blocked[] }> {
  const free: IdentifierRow[] = [];
  const blocked: Blocked[] = [];
  for (const identifier of identifiers) {
    const holder = await tx.identifier.findFirst({
      where: {
        farmId: scope.farmId,
        type: identifier.type,
        value: identifier.value,
        retiredAt: null,
        animalId: { not: animalId },
      },
      select: { animal: { select: { id: true, code: true } } },
    });
    if (holder === null) free.push(identifier);
    else blocked.push({ identifier, holderId: holder.animal.id, holderCode: holder.animal.code });
  }
  return { free, blocked };
}

function notRestoredWarnings(blocked: readonly Blocked[]): Warning[] {
  return blocked.map((item) =>
    warning('IDENTIFIER_NOT_RESTORED', { value: item.identifier.value, code: item.holderCode }),
  );
}

/** «VISUAL_TAG:123», como en la auditoría del registro. */
function label(identifier: { type: string; value: string }): string {
  return `${identifier.type}:${identifier.value}`;
}
