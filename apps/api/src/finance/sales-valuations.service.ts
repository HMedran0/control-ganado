import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  CATEGORY_LABEL,
  DomainError,
  uuidv7,
  valuationByPricePerKg,
  type CreateValuationInput,
  type IsoDate,
  type ListSalesQuery,
  type MoneyString,
  type SaleList,
  type SaleView,
  type UpdateSaleInput,
  type ValuationView,
  type VoidEventInput,
} from '@hato/shared';

import { AnimalDetailService } from '../animals/animal-detail.service.js';
import { userOf } from '../animals/animal-rules.js';
import { FarmContextService } from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  asReplayed,
  assertSameContent,
  ownRecordOrConflict,
} from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import { audit, changesBetween } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { assertEventDate, lockEventAnimal } from '../sanitary/event-rules.js';
import { lastWeights, toSaleView, toValuationView } from './finance-views.js';

const SALE_INCLUDE = { animal: { select: { id: true, code: true, name: true } } } as const;

/**
 * Ventas (ECO-04) y avalúos (ECO-03), solo ADMIN (RN-20). La venta nace con la salida (ANI-04);
 * aquí se lista y se corrige su precio, comprador u observaciones. Un avalúo no se edita: se anula
 * y se registra otro.
 */
@Injectable()
export class SalesValuationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly transactions: TransactionsService,
    private readonly farmContext: FarmContextService,
    private readonly details: AnimalDetailService,
  ) {}

  async listSales(scope: FarmScope, query: ListSalesQuery): Promise<SaleList> {
    const { limit, cursor } = parsePagination(query);
    const rows = await this.prisma.sale.findMany({
      where: {
        AND: [
          {
            farmId: scope.farmId,
            voidedAt: null,
            ...(query.from === undefined && query.to === undefined
              ? {}
              : {
                  soldOn: {
                    ...(query.from === undefined ? {} : { gte: toPrismaDate(query.from) }),
                    ...(query.to === undefined ? {} : { lte: toPrismaDate(query.to) }),
                  },
                }),
          },
          cursor === null
            ? {}
            : {
                OR: [
                  { soldOn: { lt: toPrismaDate(String(cursor.date) as IsoDate) } },
                  {
                    soldOn: toPrismaDate(String(cursor.date) as IsoDate),
                    id: { lt: String(cursor.id) },
                  },
                ],
              },
        ],
      },
      include: SALE_INCLUDE,
      orderBy: [{ soldOn: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toSaleView),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ date: fromPrismaDate(last.soldOn), id: last.id })
          : null,
    };
  }

  /** `PATCH /sales/:id`: precio, comprador u observaciones, con `version` (ADR-012). */
  async updateSale(scope: FarmScope, id: string, input: UpdateSaleInput): Promise<SaleView> {
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM sales WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
      const current = await tx.sale.findFirst({
        where: { id, farmId: scope.farmId },
        include: SALE_INCLUDE,
      });
      if (current === null) throw new DomainError('NOT_FOUND');
      if (current.version !== input.version) throw new DomainError('VERSION_CONFLICT');
      if (current.voidedAt !== null) throw new DomainError('SALE_VOIDED');

      const before = {
        amount: current.amount.toFixed(2),
        buyer: current.buyer,
        notes: current.notes,
      };
      const after = {
        amount:
          input.amount === undefined ? before.amount : new Prisma.Decimal(input.amount).toFixed(2),
        buyer: input.buyer === undefined ? before.buyer : emptyToNull(input.buyer),
        notes: input.notes === undefined ? before.notes : emptyToNull(input.notes),
      };
      const diff = changesBetween(before, after, ['amount', 'buyer', 'notes']);
      if ((diff.changed as string[]).length === 0) return toSaleView(current);

      const updated = await tx.sale.update({
        where: { id },
        data: {
          amount: new Prisma.Decimal(after.amount),
          buyer: after.buyer,
          notes: after.notes,
          version: { increment: 1 },
          updatedById: userOf(scope),
        },
        include: SALE_INCLUDE,
      });
      await audit(tx, {
        scope,
        entity: 'Sale',
        entityId: id,
        action: AUDIT_ACTION.UPDATE,
        at,
        diff,
      });
      return toSaleView(updated);
    });
  }

  /**
   * `POST /valuations` (ECO-03): a mano, o el último peso hasta la fecha × el precio por kilo de
   * la categoría del animal (`settings.pricePerKgByCategory`).
   */
  async createValuation(scope: FarmScope, input: CreateValuationInput): Promise<ValuationView> {
    if (input.id !== undefined) {
      const existing = ownRecordOrConflict(
        await this.prisma.valuation.findUnique({ where: { id: input.id } }),
        scope.farmId,
      );
      if (existing !== null) {
        assertSameContent(
          {
            animalId: input.animalId,
            date: input.date,
            method: input.method,
            amount:
              input.amount === undefined ? undefined : new Prisma.Decimal(input.amount).toFixed(2),
          },
          {
            animalId: existing.animalId,
            date: fromPrismaDate(existing.valuedOn),
            method: existing.method,
            amount: existing.amount.toFixed(2),
          },
        );
        return asReplayed(toValuationView(existing));
      }
    }

    const today = this.clock.today();
    const at = this.clock.now();
    const amount =
      input.method === 'MANUAL'
        ? new Prisma.Decimal(input.amount ?? '0').toFixed(2)
        : await this.pricePerKgValue(scope, input.animalId, input.date);
    return this.transactions.run(async (tx) => {
      const animal = await lockEventAnimal(tx, scope, input.animalId);
      assertEventDate(input.date, animal, today);
      const id = input.id ?? uuidv7();
      const created = await tx.valuation.create({
        data: {
          id,
          farmId: scope.farmId,
          animalId: animal.id,
          valuedOn: toPrismaDate(input.date),
          amount: new Prisma.Decimal(amount),
          method: input.method,
          createdById: userOf(scope),
          createdAt: at,
          updatedAt: at,
        },
      });
      await audit(tx, {
        scope,
        entity: 'Valuation',
        entityId: id,
        action: AUDIT_ACTION.CREATE,
        at,
        diff: {
          after: { animalId: animal.id, valuedOn: input.date, amount, method: input.method },
        },
      });
      return toValuationView(created);
    });
  }

  /** `POST /valuations/:id/void`. Anular dos veces responde 200 (ADR-012). */
  async voidValuation(scope: FarmScope, id: string, input: VoidEventInput): Promise<ValuationView> {
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM valuations WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
      const current = await tx.valuation.findFirst({ where: { id, farmId: scope.farmId } });
      if (current === null) throw new DomainError('NOT_FOUND');
      if (current.voidedAt !== null) return asReplayed(toValuationView(current));
      const updated = await tx.valuation.update({
        where: { id },
        data: { voidedAt: at, voidReason: input.reason },
      });
      await audit(tx, {
        scope,
        entity: 'Valuation',
        entityId: id,
        action: AUDIT_ACTION.VOID,
        at,
        diff: { after: { reason: input.reason, animalId: current.animalId } },
      });
      return toValuationView(updated);
    });
  }

  /** Último peso hasta la fecha × precio por kilo de la categoría actual del animal. */
  private async pricePerKgValue(
    scope: FarmScope,
    animalId: string,
    date: IsoDate,
  ): Promise<MoneyString> {
    const context = await this.farmContext.load(scope);
    const animal = await this.details.detail(scope, animalId, context);
    const price = context.settings.pricePerKgByCategory[animal.category];
    if (price === undefined || price === '') {
      throw new DomainError('VALUATION_NO_PRICE', {
        params: { category: CATEGORY_LABEL[animal.category] },
      });
    }
    const weight = (await lastWeights(this.prisma, scope, [animalId], date)).get(animalId);
    if (weight === undefined) throw new DomainError('VALUATION_NO_WEIGHT');
    return valuationByPricePerKg(weight, price);
  }
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
