import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  ROLE,
  treatmentWithdrawal,
  uuidv7,
  type CreateTreatmentInput,
  type ListTreatmentsQuery,
  type TreatmentList,
  type TreatmentView,
  type VoidEventInput,
} from '@hato/shared';

import { userOf } from '../animals/animal-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  asReplayed,
  assertSameContent,
  ownRecordOrConflict,
} from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import { audit } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, fromPrismaDateOrNull, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { insertExpense, lockExpense, voidExpense } from '../finance/expense-writes.js';
import { assertEventDate, lockEventAnimal } from './event-rules.js';

const include = {
  animal: { select: { id: true, code: true, name: true } },
  expense: { select: { amount: true, voidedAt: true } },
} as const satisfies Prisma.TreatmentRecordInclude;

type TreatmentRow = Prisma.TreatmentRecordGetPayload<{ include: typeof include }>;

/** Vista del tratamiento; el costo solo para ADMIN (RN-20): para los demás la clave no existe. */
function toView(row: TreatmentRow, scope: FarmScope): TreatmentView {
  const withdrawal = treatmentWithdrawal({
    startedOn: fromPrismaDate(row.startedOn),
    durationDays: row.durationDays,
    withdrawalMeatDays: row.withdrawalMeatDays,
    withdrawalMilkDays: row.withdrawalMilkDays,
  });
  const view: TreatmentView = {
    id: row.id,
    animal: row.animal,
    startedOn: fromPrismaDate(row.startedOn),
    reason: row.reason,
    medication: row.medication,
    dose: row.dose,
    durationDays: row.durationDays,
    withdrawalMeatDays: row.withdrawalMeatDays,
    withdrawalMilkDays: row.withdrawalMilkDays,
    meatWithdrawalUntil: withdrawal.meatUntil,
    milkWithdrawalUntil: withdrawal.milkUntil,
    withdrawalUntil: fromPrismaDateOrNull(row.withdrawalUntil),
    responsible: row.responsible,
    notes: row.notes,
    workSessionId: row.workSessionId,
    voided:
      row.voidedAt === null ? null : { at: row.voidedAt.toISOString(), reason: row.voidReason },
    createdAt: row.createdAt.toISOString(),
  };
  if (scope.role !== ROLE.ADMIN) return view;
  return {
    ...view,
    cost:
      row.expense === null || row.expense.voidedAt !== null ? null : row.expense.amount.toFixed(2),
  };
}

/**
 * Tratamientos (SAN-05, RN-22). Todos los roles registran; el costo (que crea un gasto directo
 * del animal) es solo de ADMIN (RN-20). Anular es de ADMIN y VET, y anula también su gasto.
 */
@Injectable()
export class TreatmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly transactions: TransactionsService,
  ) {}

  async list(scope: FarmScope, query: ListTreatmentsQuery): Promise<TreatmentList> {
    const { limit, cursor } = parsePagination(query);
    const rows = await this.prisma.treatmentRecord.findMany({
      where: {
        farmId: scope.farmId,
        ...(query.animalId === undefined ? {} : { animalId: query.animalId }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              startedOn: {
                ...(query.from === undefined ? {} : { gte: toPrismaDate(query.from) }),
                ...(query.to === undefined ? {} : { lte: toPrismaDate(query.to) }),
              },
            }),
        ...(cursor === null ? {} : { id: { lt: String(cursor.id) } }),
      },
      include,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toView(row, scope)),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor({ id: last.id }) : null,
    };
  }

  async create(scope: FarmScope, input: CreateTreatmentInput): Promise<TreatmentView> {
    if (input.cost !== undefined && scope.role !== ROLE.ADMIN) {
      throw new DomainError('FORBIDDEN_ROLE', {
        detail: 'Solo un administrador registra el costo del tratamiento.',
      });
    }
    if (input.id !== undefined) {
      const existing = ownRecordOrConflict(
        await this.prisma.treatmentRecord.findUnique({ where: { id: input.id }, include }),
        scope.farmId,
      );
      if (existing !== null) {
        assertSameContent(
          {
            animalId: input.animalId,
            startedOn: input.startedOn,
            reason: input.reason,
            medication: input.medication,
            dose: input.dose ?? null,
            durationDays: input.durationDays,
            withdrawalMeatDays: input.withdrawalMeatDays,
            withdrawalMilkDays: input.withdrawalMilkDays,
            responsible: input.responsible ?? null,
            notes: input.notes ?? null,
          },
          {
            animalId: existing.animalId,
            startedOn: fromPrismaDate(existing.startedOn),
            reason: existing.reason,
            medication: existing.medication,
            dose: existing.dose,
            durationDays: existing.durationDays,
            withdrawalMeatDays: existing.withdrawalMeatDays,
            withdrawalMilkDays: existing.withdrawalMilkDays,
            responsible: existing.responsible,
            notes: existing.notes,
          },
        );
        return asReplayed(toView(existing, scope));
      }
    }

    const today = this.clock.today();
    const at = this.clock.now();
    const userId = userOf(scope);
    const withdrawal = treatmentWithdrawal(input);

    return this.transactions.run(async (tx) => {
      const animal = await lockEventAnimal(tx, scope, input.animalId);
      assertEventDate(input.startedOn, animal, today, 'startedOn');

      let expenseId: string | null = null;
      if (input.cost !== undefined) {
        // Gasto directo del animal tratado (SAN-05), con el núcleo de Finanzas (ADR-016).
        expenseId = uuidv7();
        const amount = new Prisma.Decimal(input.cost).toFixed(2);
        await insertExpense(tx, scope, {
          id: expenseId,
          at,
          type: 'MEDICATION',
          occurredOn: input.startedOn,
          amount,
          description: `Tratamiento de ${animal.code}: ${input.medication}`,
          method: 'DIRECT',
          lotId: null,
          allocations: [{ animalId: animal.id, amount }],
        });
      }

      const id = input.id ?? uuidv7();
      const created = await tx.treatmentRecord.create({
        data: {
          id,
          farmId: scope.farmId,
          animalId: animal.id,
          startedOn: toPrismaDate(input.startedOn),
          reason: input.reason,
          medication: input.medication,
          dose: input.dose ?? null,
          durationDays: input.durationDays,
          withdrawalMeatDays: input.withdrawalMeatDays,
          withdrawalMilkDays: input.withdrawalMilkDays,
          withdrawalUntil: withdrawal.until === null ? null : toPrismaDate(withdrawal.until),
          responsible: input.responsible ?? null,
          notes: input.notes ?? null,
          expenseId,
          createdById: userId,
          createdAt: at,
          updatedAt: at,
        },
        include,
      });
      await audit(tx, {
        scope,
        entity: 'TreatmentRecord',
        entityId: id,
        action: AUDIT_ACTION.CREATE,
        at,
        diff: {
          after: {
            animalId: animal.id,
            startedOn: input.startedOn,
            medication: input.medication,
            withdrawalUntil: withdrawal.until,
            meatWithdrawalUntil: withdrawal.meatUntil,
            milkWithdrawalUntil: withdrawal.milkUntil,
          },
        },
      });
      return toView(created, scope);
    });
  }

  async void(scope: FarmScope, id: string, input: VoidEventInput): Promise<TreatmentView> {
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM treatment_records
        WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
      const current = await tx.treatmentRecord.findFirst({
        where: { id, farmId: scope.farmId },
        include,
      });
      if (current === null) throw new DomainError('NOT_FOUND');
      if (current.voidedAt !== null) return asReplayed(toView(current, scope));

      const updated = await tx.treatmentRecord.update({
        where: { id },
        data: { voidedAt: at, voidReason: input.reason },
        include,
      });
      // El gasto del tratamiento deja de contar en la inversión del animal (RN-18).
      if (current.expenseId !== null) {
        const expense = await lockExpense(tx, scope, current.expenseId);
        if (expense !== null) {
          await voidExpense(tx, scope, expense, `Tratamiento anulado: ${input.reason}`, at);
        }
      }
      await audit(tx, {
        scope,
        entity: 'TreatmentRecord',
        entityId: id,
        action: AUDIT_ACTION.VOID,
        at,
        diff: { after: { reason: input.reason, animalId: current.animalId } },
      });
      return toView(updated, scope);
    });
  }
}
