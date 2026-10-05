import { Injectable } from '@nestjs/common';
import {
  DomainError,
  uuidv7,
  type CreateExpenseInput,
  type ExpenseDetail,
  type ExpenseList,
  type ExpensePreview,
  type IsoDate,
  type ListExpensesQuery,
  type MoneyString,
  type UpdateExpenseInput,
  type VoidEventInput,
} from '@hato/shared';

import { assertNotFuture, fieldError } from '../animals/animal-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  asReplayed,
  assertSameContent,
  ownRecordOrConflict,
} from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import type { Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  insertExpense,
  lockExpense,
  planAllocations,
  reviseExpense,
  voidExpense,
  type ExpenseContent,
  type StoredExpense,
} from './expense-writes.js';
import {
  EXPENSE_INCLUDE,
  expenseViews,
  loadExpenseDetail,
  resolveTargets,
  sameTargets,
} from './finance-views.js';

/**
 * Gastos (ECO-01, ECO-02), solo ADMIN (RN-20). Directos, repartidos entre un lote o una
 * selección (partes iguales o por peso) y generales. El reparto lo hace `allocateExpense` con los
 * animales ordenados por id (ADR-016); corregir o anular deja las asignaciones anteriores
 * anuladas y queda en la auditoría.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly transactions: TransactionsService,
  ) {}

  async list(scope: FarmScope, query: ListExpensesQuery): Promise<ExpenseList> {
    const { limit, cursor } = parsePagination(query);
    const includeVoided = query.voided === 'true';
    const where: Prisma.ExpenseWhereInput = {
      farmId: scope.farmId,
      ...(includeVoided ? {} : { voidedAt: null }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.lotId === undefined ? {} : { lotId: query.lotId }),
      ...(query.q === undefined || query.q === ''
        ? {}
        : { description: { contains: query.q, mode: 'insensitive' } }),
      ...(query.animalId === undefined
        ? {}
        : {
            allocations: {
              some: {
                animalId: query.animalId,
                ...(includeVoided ? {} : { voidedAt: null }),
              },
            },
          }),
      ...(query.from === undefined && query.to === undefined
        ? {}
        : {
            occurredOn: {
              ...(query.from === undefined ? {} : { gte: toPrismaDate(query.from) }),
              ...(query.to === undefined ? {} : { lte: toPrismaDate(query.to) }),
            },
          }),
    };
    // Del más reciente al más antiguo: fecha del gasto y, en el mismo día, id.
    const after: Prisma.ExpenseWhereInput =
      cursor === null
        ? {}
        : {
            OR: [
              { occurredOn: { lt: toPrismaDate(String(cursor.date) as IsoDate) } },
              {
                occurredOn: toPrismaDate(String(cursor.date) as IsoDate),
                id: { lt: String(cursor.id) },
              },
            ],
          };
    const rows = await this.prisma.expense.findMany({
      where: { AND: [where, after] },
      include: EXPENSE_INCLUDE,
      orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await expenseViews(this.prisma, page),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ date: fromPrismaDate(last.occurredOn), id: last.id })
          : null,
    };
  }

  async detail(scope: FarmScope, id: string): Promise<ExpenseDetail> {
    return loadExpenseDetail(this.prisma, scope, id);
  }

  /** `POST /expenses`. Con `dryRun`, el reparto que se guardaría (ECO-02), sin guardar nada. */
  async create(
    scope: FarmScope,
    input: CreateExpenseInput,
  ): Promise<ExpenseDetail | ExpensePreview> {
    if (input.type === 'PURCHASE') {
      throw new DomainError('EXPENSE_PURCHASE_FROM_ANIMAL', {
        fieldErrors: { type: ['La compra se registra en la ficha del animal.'] },
      });
    }
    assertNotFuture(input.date, this.clock.today(), 'date');
    const amount = money(input.amount);

    if (input.dryRun === true) {
      const targets = await resolveTargets(this.prisma, scope, input.allocation, input.date);
      return {
        dryRun: true,
        amount,
        method: targets.method,
        allocations: planAllocations({ amount, ...targets }).map((allocation) => ({
          animal: targets.refs.get(allocation.animalId) ?? {
            id: allocation.animalId,
            code: '',
            name: null,
          },
          amount: allocation.amount,
        })),
      };
    }

    if (input.id !== undefined) {
      const replay = await this.replayed(scope, input);
      if (replay !== null) return replay;
    }

    const at = this.clock.now();
    const id = input.id ?? uuidv7();
    return this.transactions.run(async (tx) => {
      const targets = await resolveTargets(tx, scope, input.allocation, input.date);
      await insertExpense(tx, scope, {
        id,
        at,
        type: input.type,
        occurredOn: input.date,
        amount,
        description: input.description,
        method: targets.method,
        lotId: targets.lotId,
        allocations: planAllocations({ amount, ...targets }),
      });
      return loadExpenseDetail(tx, scope, id);
    });
  }

  /**
   * `PATCH /expenses/:id` (ADR-016). Sin `allocation`, los mismos animales: el reparto se vuelve a
   * calcular solo si cambió el monto o la fecha (en uno por peso, los pesos dependen de la fecha).
   * Corregir solo la descripción o el tipo no toca ninguna asignación. El gasto de un tratamiento
   * o de una compra sigue siendo de su animal.
   */
  async update(scope: FarmScope, id: string, input: UpdateExpenseInput): Promise<ExpenseDetail> {
    const today = this.clock.today();
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      const current = await lockExpense(tx, scope, id);
      if (current === null) throw new DomainError('NOT_FOUND');
      if (current.version !== input.version) throw new DomainError('VERSION_CONFLICT');
      if (current.voided) throw new DomainError('EXPENSE_VOIDED');

      const type = input.type ?? current.type;
      if ((type === 'PURCHASE') !== (current.type === 'PURCHASE')) {
        throw fieldError(
          'VALIDATION_FAILED',
          'type',
          current.type === 'PURCHASE'
            ? 'La compra de un animal sigue siendo compra.'
            : 'La compra se registra en la ficha del animal.',
        );
      }
      if (input.allocation !== undefined) {
        const linked = await this.linkedTo(tx, current);
        if (linked !== null) throw fieldError('VALIDATION_FAILED', 'allocation', linked);
      }
      if (input.date !== undefined) assertNotFuture(input.date, today, 'date');
      const date = input.date ?? current.occurredOn;
      const amount = input.amount === undefined ? current.amount : money(input.amount);
      const resplit = amount !== current.amount || date !== current.occurredOn;

      let next: ExpenseContent = {
        type,
        occurredOn: date,
        amount,
        description: input.description ?? current.description,
        method: current.method,
        lotId: current.lotId,
        allocations: current.allocations,
      };
      if (input.allocation !== undefined || resplit) {
        const targets =
          input.allocation === undefined
            ? await sameTargets(
                tx,
                scope,
                {
                  method: current.method,
                  lotId: current.lotId,
                  animalIds: current.allocations.map((allocation) => allocation.animalId),
                },
                date,
              )
            : await resolveTargets(tx, scope, input.allocation, date);
        next = {
          ...next,
          method: targets.method,
          lotId: targets.lotId,
          allocations: planAllocations({ amount, ...targets }),
        };
      }
      await reviseExpense(tx, scope, current, next, at);
      return loadExpenseDetail(tx, scope, id);
    });
  }

  /** `POST /expenses/:id/void`. Anular dos veces responde 200 con el gasto (ADR-012). */
  async void(scope: FarmScope, id: string, input: VoidEventInput): Promise<ExpenseDetail> {
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      const current = await lockExpense(tx, scope, id);
      if (current === null) throw new DomainError('NOT_FOUND');
      const voided = await voidExpense(tx, scope, current, input.reason, at);
      const detail = await loadExpenseDetail(tx, scope, id);
      return voided ? detail : asReplayed(detail);
    });
  }

  /** ¿El gasto es de un tratamiento o de una compra? Entonces sus animales no se cambian. */
  private async linkedTo(tx: Tx, expense: StoredExpense): Promise<string | null> {
    if (expense.type === 'PURCHASE') {
      return 'La compra es del animal comprado: corrígela en su ficha si es de otro.';
    }
    const treatment = await tx.treatmentRecord.findFirst({
      where: { expenseId: expense.id },
      select: { id: true },
    });
    return treatment === null ? null : 'El costo de un tratamiento es del animal tratado.';
  }

  /** Repetición de una creación con el mismo `id` (ADR-012 §1). */
  private async replayed(
    scope: FarmScope,
    input: CreateExpenseInput,
  ): Promise<ExpenseDetail | null> {
    const existing = ownRecordOrConflict(
      await this.prisma.expense.findUnique({
        where: { id: input.id },
        include: { allocations: { select: { animalId: true }, orderBy: { animalId: 'asc' } } },
      }),
      scope.farmId,
    );
    if (existing === null) return null;
    const allocation = input.allocation;
    const storedAnimals = [...new Set(existing.allocations.map((row) => row.animalId))];
    assertSameContent(
      {
        type: input.type,
        date: input.date,
        amount: new Prisma.Decimal(input.amount).toFixed(2),
        description: input.description,
        method: allocation.method,
        lotId: allocation.lotId,
        animals:
          allocation.animalId === undefined
            ? allocation.animalIds === undefined
              ? undefined
              : [...new Set(allocation.animalIds)].sort()
            : [allocation.animalId],
      },
      {
        type: existing.type,
        date: fromPrismaDate(existing.occurredOn),
        amount: existing.amount.toFixed(2),
        description: existing.description,
        method: existing.allocationMethod,
        lotId: existing.lotId,
        animals: storedAnimals,
      },
    );
    return asReplayed(await loadExpenseDetail(this.prisma, scope, existing.id));
  }
}

/** Monto normalizado a dos decimales, como lo guarda `numeric(14,2)`. */
function money(value: string): MoneyString {
  return new Prisma.Decimal(value).toFixed(2);
}
