import {
  AUDIT_ACTION,
  DomainError,
  allocateExpense,
  compareAllocationOrder,
  uuidv7,
  type AllocationMethod,
  type ExpenseType,
  type IsoDate,
  type MoneyString,
} from '@hato/shared';

import { userOf } from '../animals/animal-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { audit, type Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';

/**
 * Escritura de gastos y de su reparto, en un solo lugar (ECO-01, ECO-02, RN-17, ADR-016). La usan
 * Finanzas, el valor de compra del animal (ANI-01) y el costo del tratamiento (SAN-05), siempre
 * dentro de la transacción de quien llama.
 *
 * - Las asignaciones nunca se borran ni se editan: corregir el gasto anula las vigentes y crea las
 *   nuevas solo si el reparto cambió; anularlo anula las suyas (RN-11).
 * - La auditoría guarda el reparto como mapa `animalId → monto` antes y después, para que la
 *   pestaña Cambios de cada animal muestre su parte (solo ADMIN). Si el reparto no cambió, no
 *   aparece en la auditoría.
 */

/** Una asignación por guardar: la parte de un animal. */
export type PlannedAllocation = { readonly animalId: string; readonly amount: MoneyString };

/** Lo que define un gasto y su reparto. */
export type ExpenseContent = {
  readonly type: ExpenseType;
  readonly occurredOn: IsoDate;
  readonly amount: MoneyString;
  readonly description: string;
  readonly method: AllocationMethod;
  readonly lotId: string | null;
  /** Ordenadas por `animalId` (ADR-016). Vacía en un gasto general. */
  readonly allocations: readonly PlannedAllocation[];
};

/** Un gasto guardado, con sus asignaciones vigentes. */
export type StoredExpense = ExpenseContent & {
  readonly id: string;
  readonly version: number;
  readonly voided: boolean;
};

/** Campos del gasto que se comparan y se auditan, además del reparto. */
const EXPENSE_FIELDS = ['type', 'occurredOn', 'amount', 'description', 'method', 'lotId'] as const;

/**
 * El reparto de un gasto (RN-17): todo al animal en uno directo, nada en uno general y, en los
 * repartidos, `allocateExpense` con los animales ordenados por id y el residuo al primero.
 */
export function planAllocations(input: {
  readonly amount: MoneyString;
  readonly method: AllocationMethod;
  readonly animals: readonly { readonly animalId: string; readonly weightKg?: string | null }[];
}): PlannedAllocation[] {
  switch (input.method) {
    case 'GENERAL':
      return [];
    case 'DIRECT': {
      const [animal] = input.animals;
      if (animal === undefined || input.animals.length !== 1) {
        throw new DomainError('VALIDATION_FAILED', {
          detail: 'Un gasto directo es de un solo animal.',
        });
      }
      return [{ animalId: animal.animalId, amount: input.amount }];
    }
    default:
      return allocateExpense({
        totalAmount: input.amount,
        method: input.method,
        animals: input.animals,
      });
  }
}

/** Crea el gasto y sus asignaciones, y lo audita. */
export async function insertExpense(
  tx: Tx,
  scope: FarmScope,
  input: ExpenseContent & { readonly id: string; readonly at: Date },
): Promise<void> {
  const userId = userOf(scope);
  await tx.expense.create({
    data: {
      id: input.id,
      farmId: scope.farmId,
      type: input.type,
      occurredOn: toPrismaDate(input.occurredOn),
      amount: new Prisma.Decimal(input.amount),
      description: input.description,
      allocationMethod: input.method,
      lotId: input.lotId,
      createdById: userId,
      updatedById: userId,
      createdAt: input.at,
      updatedAt: input.at,
    },
  });
  await insertAllocations(tx, scope, input.id, input.allocations, input.at);
  await audit(tx, {
    scope,
    entity: 'Expense',
    entityId: input.id,
    action: AUDIT_ACTION.CREATE,
    at: input.at,
    diff: { after: snapshot(input) },
  });
}

/**
 * Corrige un gasto vigente (ADR-016). Si nada cambió, no escribe ni audita. Si el reparto es el
 * mismo (por ejemplo, solo cambió la descripción), las asignaciones no se tocan y la auditoría no
 * las menciona.
 *
 * @returns `true` si hubo cambios.
 */
export async function reviseExpense(
  tx: Tx,
  scope: FarmScope,
  current: StoredExpense,
  next: ExpenseContent,
  at: Date,
): Promise<boolean> {
  if (current.voided) throw new DomainError('EXPENSE_VOIDED');
  const before = snapshot(current);
  const after = snapshot(next);
  const changedFields = EXPENSE_FIELDS.filter((field) => before[field] !== after[field]);
  const allocationsChanged = !sameAllocations(current.allocations, next.allocations);
  if (changedFields.length === 0 && !allocationsChanged) return false;

  await tx.expense.update({
    where: { id: current.id },
    data: {
      type: next.type,
      occurredOn: toPrismaDate(next.occurredOn),
      amount: new Prisma.Decimal(next.amount),
      description: next.description,
      allocationMethod: next.method,
      lotId: next.lotId,
      version: { increment: 1 },
      updatedById: userOf(scope),
    },
  });
  if (allocationsChanged) {
    await tx.expenseAllocation.updateMany({
      where: { expenseId: current.id, voidedAt: null },
      data: { voidedAt: at },
    });
    await insertAllocations(tx, scope, current.id, next.allocations, at);
  }

  const changed = [...changedFields, ...(allocationsChanged ? ['allocations'] : [])];
  const pick = (value: ReturnType<typeof snapshot>) =>
    Object.fromEntries(changed.map((field) => [field, value[field as keyof typeof value]]));
  await audit(tx, {
    scope,
    entity: 'Expense',
    entityId: current.id,
    action: AUDIT_ACTION.UPDATE,
    at,
    diff: { changed, before: pick(before), after: pick(after) },
  });
  return true;
}

/**
 * Anula el gasto y sus asignaciones (RN-11): deja de contar en la inversión de cada animal
 * (RN-18). Anular lo anulado no hace nada.
 *
 * @returns `true` si lo anuló ahora.
 */
export async function voidExpense(
  tx: Tx,
  scope: FarmScope,
  current: StoredExpense,
  reason: string,
  at: Date,
): Promise<boolean> {
  if (current.voided) return false;
  await tx.expense.update({
    where: { id: current.id },
    data: {
      voidedAt: at,
      voidReason: reason,
      version: { increment: 1 },
      updatedById: userOf(scope),
    },
  });
  await tx.expenseAllocation.updateMany({
    where: { expenseId: current.id, voidedAt: null },
    data: { voidedAt: at },
  });
  await audit(tx, {
    scope,
    entity: 'Expense',
    entityId: current.id,
    action: AUDIT_ACTION.VOID,
    at,
    diff: {
      before: { allocations: allocationMap(current.allocations) },
      after: { reason, allocations: {} },
    },
  });
  return true;
}

/** Bloquea el gasto hasta el fin de la transacción y lo devuelve con sus asignaciones vigentes. */
export async function lockExpense(
  tx: Tx,
  scope: FarmScope,
  id: string,
): Promise<StoredExpense | null> {
  await tx.$queryRaw`
    SELECT id FROM expenses WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
  const row = await tx.expense.findFirst({
    where: { id, farmId: scope.farmId },
    include: {
      allocations: {
        where: { voidedAt: null },
        select: { animalId: true, amount: true },
        orderBy: { animalId: 'asc' },
      },
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    version: row.version,
    voided: row.voidedAt !== null,
    type: row.type,
    occurredOn: fromPrismaDate(row.occurredOn),
    amount: row.amount.toFixed(2),
    description: row.description,
    method: row.allocationMethod,
    lotId: row.lotId,
    allocations: row.allocations
      .map((allocation) => ({
        animalId: allocation.animalId,
        amount: allocation.amount.toFixed(2),
      }))
      .sort(compareAllocationOrder),
  };
}

async function insertAllocations(
  tx: Tx,
  scope: FarmScope,
  expenseId: string,
  allocations: readonly PlannedAllocation[],
  at: Date,
): Promise<void> {
  if (allocations.length === 0) return;
  await tx.expenseAllocation.createMany({
    data: allocations.map((allocation) => ({
      id: uuidv7(),
      farmId: scope.farmId,
      expenseId,
      animalId: allocation.animalId,
      amount: new Prisma.Decimal(allocation.amount),
      createdAt: at,
      updatedAt: at,
    })),
  });
}

/** El gasto como lo guarda la auditoría: los campos y el reparto como mapa animal → monto. */
function snapshot(content: ExpenseContent) {
  return {
    type: content.type,
    occurredOn: content.occurredOn,
    amount: content.amount,
    description: content.description,
    method: content.method,
    lotId: content.lotId,
    allocations: allocationMap(content.allocations),
  };
}

function allocationMap(allocations: readonly PlannedAllocation[]): Record<string, string> {
  return Object.fromEntries(
    [...allocations]
      .sort(compareAllocationOrder)
      .map((allocation) => [allocation.animalId, allocation.amount]),
  );
}

function sameAllocations(
  a: readonly PlannedAllocation[],
  b: readonly PlannedAllocation[],
): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort(compareAllocationOrder);
  const right = [...b].sort(compareAllocationOrder);
  return left.every(
    (allocation, index) =>
      allocation.animalId === right[index]?.animalId && allocation.amount === right[index].amount,
  );
}
