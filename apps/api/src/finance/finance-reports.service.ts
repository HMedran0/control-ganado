import { Injectable } from '@nestjs/common';
import {
  DomainError,
  EXPENSE_TYPE,
  MANAGEMENT_CATEGORY,
  animalInvestment,
  animalResult,
  formatMoneyValue,
  parseMoney,
  toIsoDate,
  type AnimalFinance,
  type ExpenseType,
  type FinanceSummary,
  type FinanceSummaryQuery,
  type ManagementCategory,
} from '@hato/shared';

import { classificationCtes } from '../animals/classification.sql.js';
import { FarmContextService, classificationParams } from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { toSaleView, toValuationView } from './finance-views.js';
import { investmentCte } from './investment.sql.js';

/**
 * Lo que se lee de las finanzas, solo ADMIN (RN-20): la pestaña Costos de la ficha (ECO-05) y el
 * reporte económico (ECO-06). Los agregados del reporte salen de SQL; la inversión por animal es
 * la CTE `investment`, equivalente a `animalInvestment` de shared (ADR-009).
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
  ) {}

  /** `GET /animals/:id/finance` (ECO-05): inversión, desglose, avalúos, venta y resultado. */
  async animalFinance(scope: FarmScope, animalId: string): Promise<AnimalFinance> {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId: scope.farmId },
      select: { id: true },
    });
    if (animal === null) throw new DomainError('NOT_FOUND');

    const [allocations, valuations, sale] = await Promise.all([
      this.prisma.expenseAllocation.findMany({
        where: { farmId: scope.farmId, animalId, voidedAt: null, expense: { voidedAt: null } },
        select: {
          amount: true,
          expense: {
            select: {
              id: true,
              occurredOn: true,
              type: true,
              description: true,
              allocationMethod: true,
              amount: true,
              lot: { select: { id: true, name: true } },
              _count: { select: { allocations: { where: { voidedAt: null } } } },
            },
          },
        },
        orderBy: [{ expense: { occurredOn: 'desc' } }, { expenseId: 'desc' }],
      }),
      this.prisma.valuation.findMany({
        where: { farmId: scope.farmId, animalId, voidedAt: null },
        orderBy: [{ valuedOn: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.sale.findFirst({
        where: { farmId: scope.farmId, animalId, voidedAt: null },
        include: { animal: { select: { id: true, code: true, name: true } } },
      }),
    ]);

    const lines = allocations.map((allocation) => ({
      expenseId: allocation.expense.id,
      date: fromPrismaDate(allocation.expense.occurredOn),
      type: allocation.expense.type,
      description: allocation.expense.description,
      method: allocation.expense.allocationMethod,
      amount: allocation.amount.toFixed(2),
      expenseAmount: allocation.expense.amount.toFixed(2),
      animalCount: allocation.expense._count.allocations,
      lot: allocation.expense.lot,
    }));
    const investment = animalInvestment(
      lines.map((line) => ({ type: line.type, amount: line.amount, voided: false })),
    );
    const saleView = sale === null ? null : toSaleView(sale);
    const valuationViews = valuations.map(toValuationView);
    return {
      animalId,
      investment,
      lines,
      valuations: valuationViews,
      sale: saleView,
      result: animalResult({
        investment: investment.total,
        saleAmount: saleView?.amount ?? null,
        valuationAmount: valuationViews[0]?.amount ?? null,
      }),
    };
  }

  /** `GET /finance/summary` (ECO-06). Sin fechas, del 1.º de enero a hoy. */
  async summary(scope: FarmScope, query: FinanceSummaryQuery): Promise<FinanceSummary> {
    const context = await this.farmContext.load(scope);
    const to = query.to ?? context.today;
    const from = query.from ?? toIsoDate(`${to.slice(0, 4)}-01-01`);
    const farm = Prisma.sql`${scope.farmId}::uuid`;

    const [herd, expenses, sales] = await Promise.all([
      this.prisma.$queryRaw<{ category: string; animals: number; investment: string }[]>(Prisma.sql`
        WITH ${classificationCtes(classificationParams(scope, context))},
             ${investmentCte(scope.farmId)}
        SELECT c.category, count(*)::int AS animals,
               COALESCE(sum(i.total), 0)::numeric(14,2)::text AS investment
          FROM classified c
          LEFT JOIN investment i ON i.animal_id = c.animal_id
         WHERE c.is_active
         GROUP BY c.category`),
      this.prisma.$queryRaw<
        { month: string; type: ExpenseType; general: boolean; amount: string }[]
      >(Prisma.sql`
        SELECT to_char(e.occurred_on, 'YYYY-MM') AS month, e.type::text AS type,
               (e.allocation_method::text = 'GENERAL') AS general,
               sum(e.amount)::numeric(14,2)::text AS amount
          FROM expenses e
         WHERE e.farm_id = ${farm} AND e.voided_at IS NULL
           AND e.occurred_on BETWEEN ${from}::date AND ${to}::date
         GROUP BY 1, 2, 3`),
      this.prisma.$queryRaw<
        {
          sale_id: string;
          animal_id: string;
          code: string;
          name: string | null;
          sold_on: Date;
          buyer: string | null;
          amount: string;
          investment: string;
        }[]
      >(Prisma.sql`
        WITH ${investmentCte(scope.farmId)}
        SELECT s.id AS sale_id, a.id AS animal_id, a.code, a.name, s.sold_on, s.buyer,
               s.amount::text AS amount, COALESCE(i.total, 0)::numeric(14,2)::text AS investment
          FROM sales s
          JOIN animals a ON a.id = s.animal_id
          LEFT JOIN investment i ON i.animal_id = s.animal_id
         WHERE s.farm_id = ${farm} AND s.voided_at IS NULL
           AND s.sold_on BETWEEN ${from}::date AND ${to}::date
         ORDER BY s.sold_on DESC, s.id DESC`),
    ]);

    const sum = (values: readonly string[]) =>
      values.reduce((total, value) => total + parseMoney(value), 0n);

    const categories = Object.values(MANAGEMENT_CATEGORY);
    const byCategory = herd
      .map((row) => ({
        category: row.category as ManagementCategory,
        animals: row.animals,
        investment: row.investment,
      }))
      .sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category));

    const byType = Object.values(EXPENSE_TYPE)
      .map((type) => ({
        type,
        cents: sum(expenses.filter((row) => row.type === type).map((row) => row.amount)),
      }))
      .filter((row) => row.cents !== 0n)
      .map((row) => ({ type: row.type, amount: formatMoneyValue(row.cents) }));
    const months = [...new Set(expenses.map((row) => row.month))].sort();
    const general = sum(expenses.filter((row) => row.general).map((row) => row.amount));
    const allocated = sum(expenses.filter((row) => !row.general).map((row) => row.amount));

    const saleItems = sales.map((row) => {
      const result = parseMoney(row.amount) - parseMoney(row.investment);
      return {
        saleId: row.sale_id,
        animal: { id: row.animal_id, code: row.code, name: row.name },
        date: fromPrismaDate(row.sold_on),
        buyer: row.buyer,
        amount: row.amount,
        investment: row.investment,
        result: formatMoneyValue(result),
      };
    });

    return {
      from,
      to,
      herd: {
        animals: byCategory.reduce((total, row) => total + row.animals, 0),
        investment: formatMoneyValue(sum(byCategory.map((row) => row.investment))),
        byCategory,
      },
      expenses: {
        total: formatMoneyValue(general + allocated),
        allocated: formatMoneyValue(allocated),
        general: formatMoneyValue(general),
        byType,
        byMonth: months.map((month) => ({
          month,
          amount: formatMoneyValue(
            sum(expenses.filter((row) => row.month === month).map((row) => row.amount)),
          ),
        })),
      },
      sales: {
        count: saleItems.length,
        total: formatMoneyValue(sum(saleItems.map((item) => item.amount))),
        investment: formatMoneyValue(sum(saleItems.map((item) => item.investment))),
        result: formatMoneyValue(sum(saleItems.map((item) => item.result))),
        items: saleItems,
      },
    };
  }
}
