import {
  DomainError,
  compareAllocationOrder,
  type AllocationMethod,
  type AnimalRef,
  type ExpenseAllocationInput,
  type ExpenseDetail,
  type ExpenseView,
  type IsoDate,
  type SaleView,
  type ValuationView,
} from '@hato/shared';

import { fieldError } from '../animals/animal-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate } from '../infra/date-mapper.js';

/** Lo que se lee de un gasto para mostrarlo. */
export const EXPENSE_INCLUDE = {
  lot: { select: { id: true, name: true } },
  treatments: { select: { id: true }, take: 1 },
  _count: { select: { allocations: { where: { voidedAt: null } } } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

/** Vista de un gasto. `directAnimal` y `createdBy` se buscan aparte, en lote. */
export function toExpenseView(
  row: ExpenseRow,
  extra: { readonly directAnimal: AnimalRef | null; readonly createdBy: string },
): ExpenseView {
  return {
    id: row.id,
    type: row.type,
    date: fromPrismaDate(row.occurredOn),
    amount: row.amount.toFixed(2),
    description: row.description,
    method: row.allocationMethod,
    lot: row.lot,
    animalCount: row._count.allocations,
    animal: extra.directAnimal,
    treatmentId: row.treatments[0]?.id ?? null,
    voided: row.voidedAt !== null,
    voidReason: row.voidReason,
    version: row.version,
    createdBy: extra.createdBy,
  };
}

/**
 * Vistas de varios gastos: el animal de los directos y el nombre de quien los registró, con dos
 * consultas para toda la página.
 */
export async function expenseViews(db: Tx, rows: readonly ExpenseRow[]): Promise<ExpenseView[]> {
  const direct = rows.filter((row) => row.allocationMethod === 'DIRECT').map((row) => row.id);
  const [allocations, users] = await Promise.all([
    db.expenseAllocation.findMany({
      where: { expenseId: { in: direct } },
      orderBy: [{ voidedAt: { sort: 'desc', nulls: 'first' } }, { id: 'desc' }],
      select: {
        expenseId: true,
        animal: { select: { id: true, code: true, name: true } },
      },
    }),
    db.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } },
      select: { id: true, name: true },
    }),
  ]);
  // El animal del directo, aunque el gasto esté anulado (la vigente primero).
  const animals = new Map<string, AnimalRef>();
  for (const allocation of allocations) {
    if (!animals.has(allocation.expenseId)) animals.set(allocation.expenseId, allocation.animal);
  }
  const names = new Map(users.map((user) => [user.id, user.name]));
  return rows.map((row) =>
    toExpenseView(row, {
      directAnimal: animals.get(row.id) ?? null,
      createdBy: names.get(row.createdById) ?? '',
    }),
  );
}

/** El gasto con sus asignaciones vigentes, ordenadas por animal (ADR-016). */
export async function loadExpenseDetail(
  db: Tx,
  scope: FarmScope,
  id: string,
): Promise<ExpenseDetail> {
  const row = await db.expense.findFirst({
    where: { id, farmId: scope.farmId },
    include: EXPENSE_INCLUDE,
  });
  if (row === null) throw new DomainError('NOT_FOUND');
  const [view] = await expenseViews(db, [row]);
  const allocations = await db.expenseAllocation.findMany({
    where: { expenseId: id, voidedAt: null },
    orderBy: { animalId: 'asc' },
    select: { amount: true, animal: { select: { id: true, code: true, name: true } } },
  });
  return {
    ...(view as ExpenseView),
    allocations: allocations.map((allocation) => ({
      animal: allocation.animal,
      amount: allocation.amount.toFixed(2),
    })),
  };
}

type SaleRow = Prisma.SaleGetPayload<{
  include: { animal: { select: { id: true; code: true; name: true } } };
}>;

export function toSaleView(row: SaleRow): SaleView {
  return {
    id: row.id,
    animal: row.animal,
    date: fromPrismaDate(row.soldOn),
    amount: row.amount.toFixed(2),
    buyer: row.buyer,
    notes: row.notes,
    voided: row.voidedAt !== null,
    version: row.version,
  };
}

type ValuationRow = Prisma.ValuationGetPayload<object>;

export function toValuationView(row: ValuationRow): ValuationView {
  return {
    id: row.id,
    animalId: row.animalId,
    date: fromPrismaDate(row.valuedOn),
    amount: row.amount.toFixed(2),
    method: row.method,
    voided: row.voidedAt !== null,
  };
}

// ---------------------------------------------------------------------------------------------
// A quién se carga el gasto
// ---------------------------------------------------------------------------------------------

/** Animales del reparto, ordenados por id, con su último peso si el método lo pide. */
export type ResolvedTargets = {
  readonly method: AllocationMethod;
  readonly lotId: string | null;
  readonly animals: readonly {
    readonly animalId: string;
    readonly weightKg?: string | null;
  }[];
  readonly refs: ReadonlyMap<string, AnimalRef>;
};

/** Hasta cuántos códigos se nombran en un mensaje de error. */
const NAMED_CODES = 10;

function codesText(codes: readonly string[]): string {
  const shown = codes.slice(0, NAMED_CODES).join(', ');
  return codes.length > NAMED_CODES ? `${shown} y ${codes.length - NAMED_CODES} más` : shown;
}

/**
 * Resuelve a quién se carga el gasto (ECO-01, ECO-02):
 * - directo: el animal, que no esté archivado ni hubiera salido antes de la fecha del gasto;
 * - por lote: los animales activos del lote hoy, en orden de id;
 * - por selección: los elegidos, con las mismas condiciones que el directo;
 * - general: nadie.
 * Con `BY_WEIGHT`, el último pesaje vigente de cada uno hasta la fecha del gasto.
 *
 * @throws {DomainError} `ALLOCATION_EMPTY` si el lote no tiene animales activos;
 *   `ALLOCATION_NO_WEIGHT` con los códigos de los que no tienen peso.
 */
export async function resolveTargets(
  db: Tx,
  scope: FarmScope,
  allocation: ExpenseAllocationInput,
  date: IsoDate,
): Promise<ResolvedTargets> {
  const farmId = scope.farmId;
  if (allocation.method === 'GENERAL') {
    return { method: 'GENERAL', lotId: null, animals: [], refs: new Map() };
  }

  let lotId: string | null = null;
  let rows: { id: string; code: string; name: string | null }[];
  if (allocation.lotId !== undefined) {
    const lot = await db.lot.findFirst({ where: { id: allocation.lotId, farmId } });
    if (lot === null)
      throw fieldError('VALIDATION_FAILED', 'allocation.lotId', 'Ese lote no existe.');
    lotId = lot.id;
    rows = await db.animal.findMany({
      where: { farmId, lotId: lot.id, deletedAt: null, exitType: null },
      select: { id: true, code: true, name: true },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) {
      throw new DomainError('ALLOCATION_EMPTY', {
        detail: `El lote ${lot.name} no tiene animales activos para repartir el gasto.`,
      });
    }
  } else {
    const ids =
      allocation.method === 'DIRECT'
        ? [allocation.animalId ?? '']
        : [...new Set(allocation.animalIds ?? [])];
    const field = allocation.method === 'DIRECT' ? 'allocation.animalId' : 'allocation.animalIds';
    const found = await db.animal.findMany({
      where: { farmId, id: { in: ids } },
      select: { id: true, code: true, name: true, deletedAt: true, exitDate: true },
      orderBy: { id: 'asc' },
    });
    if (found.length !== ids.length) {
      const missing = ids.length - found.length;
      throw fieldError(
        'VALIDATION_FAILED',
        field,
        missing === 1
          ? 'Un animal no existe en esta finca.'
          : `${missing} animales no existen en esta finca.`,
      );
    }
    const archived = found.filter((animal) => animal.deletedAt !== null);
    if (archived.length > 0) {
      throw fieldError(
        'VALIDATION_FAILED',
        field,
        `Están archivados: ${codesText(archived.map((animal) => animal.code))}.`,
      );
    }
    const gone = found.filter(
      (animal) => animal.exitDate !== null && fromPrismaDate(animal.exitDate) < date,
    );
    if (gone.length > 0) {
      throw fieldError(
        'VALIDATION_FAILED',
        field,
        `Ya habían salido de la finca en esa fecha: ${codesText(gone.map((animal) => animal.code))}.`,
      );
    }
    rows = found;
  }

  const refs = new Map(rows.map((row) => [row.id, { id: row.id, code: row.code, name: row.name }]));
  if (allocation.method !== 'BY_WEIGHT') {
    return {
      method: allocation.method,
      lotId,
      animals: rows.map((row) => ({ animalId: row.id })),
      refs,
    };
  }

  return withWeights(db, scope, rows, date, { method: 'BY_WEIGHT', lotId, refs });
}

/**
 * Los mismos animales de un gasto guardado, para repartir otra vez con su método cuando cambia
 * el monto o la fecha (ADR-016). No se vuelven a validar: un animal archivado o vendido después
 * sigue teniendo su parte del gasto.
 */
export async function sameTargets(
  db: Tx,
  scope: FarmScope,
  current: {
    readonly method: AllocationMethod;
    readonly lotId: string | null;
    readonly animalIds: readonly string[];
  },
  date: IsoDate,
): Promise<ResolvedTargets> {
  const rows = await db.animal.findMany({
    where: { farmId: scope.farmId, id: { in: [...current.animalIds] } },
    select: { id: true, code: true, name: true },
    orderBy: { id: 'asc' },
  });
  const refs = new Map(rows.map((row) => [row.id, { id: row.id, code: row.code, name: row.name }]));
  if (current.method !== 'BY_WEIGHT') {
    return {
      method: current.method,
      lotId: current.lotId,
      animals: rows.map((row) => ({ animalId: row.id })),
      refs,
    };
  }
  return withWeights(db, scope, rows, date, { method: 'BY_WEIGHT', lotId: current.lotId, refs });
}

/** Agrega el último peso de cada animal hasta la fecha; si falta alguno, dice cuáles. */
async function withWeights(
  db: Tx,
  scope: FarmScope,
  rows: readonly { readonly id: string; readonly code: string }[],
  date: IsoDate,
  base: Pick<ResolvedTargets, 'method' | 'lotId' | 'refs'>,
): Promise<ResolvedTargets> {
  const weights = await lastWeights(
    db,
    scope,
    rows.map((row) => row.id),
    date,
  );
  const missing = rows.filter((row) => !weights.has(row.id));
  if (missing.length > 0) {
    throw new DomainError('ALLOCATION_NO_WEIGHT', {
      detail: `Sin peso registrado hasta esa fecha: ${codesText(missing.map((row) => row.code))}. Usa partes iguales o registra el peso.`,
    });
  }
  return {
    ...base,
    animals: rows
      .map((row) => ({ animalId: row.id, weightKg: weights.get(row.id) ?? null }))
      .sort(compareAllocationOrder),
  };
}

/** Último pesaje vigente de cada animal hasta la fecha, como cadena decimal. */
export async function lastWeights(
  db: Tx,
  scope: FarmScope,
  animalIds: readonly string[],
  date: IsoDate,
): Promise<Map<string, string>> {
  if (animalIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ animal_id: string; weight_kg: string }[]>`
    SELECT DISTINCT ON (w.animal_id) w.animal_id, w.weight_kg::text AS weight_kg
      FROM weight_records w
     WHERE w.farm_id = ${scope.farmId}::uuid
       AND w.animal_id = ANY(${animalIds}::uuid[])
       AND w.voided_at IS NULL
       AND w.weighed_on <= ${date}::date
     ORDER BY w.animal_id, w.weighed_on DESC, w.id DESC`;
  return new Map(rows.map((row) => [row.animal_id, row.weight_kg]));
}
