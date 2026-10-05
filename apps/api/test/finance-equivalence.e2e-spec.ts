import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { animalInvestment, type FinanceSummary } from '@hato/shared';
import request from 'supertest';

import { EXPECTED_FINANCE } from '../prisma/seed/expected.js';
import { SEED_TODAY } from '../prisma/seed/guards.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { investmentCte } from '../src/finance/investment.sql.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase } from './helpers/fixtures.js';

/**
 * ADR-009 para las finanzas (M7): la inversión por animal en SQL (CTE `investment`, la que usa el
 * reporte económico) da exactamente lo mismo que `animalInvestment` de shared, animal por animal,
 * sobre la finca de referencia, que tiene compras, repartos por lote y por peso, tratamientos,
 * gastos generales y un gasto anulado. Y el reporte coincide con las cifras de `expected.ts`.
 */
describe('Equivalencia de la inversión: SQL ↔ shared (ADR-009, RN-18)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farmId: string;
  let admin: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const { seed } = await runReferenceSeed(prisma, {
      password: 'contraseña-de-prueba-del-seed',
      today: SEED_TODAY,
    });
    farmId = seed.catalog.farmId;
    const alvaro = await prisma.user.findUniqueOrThrow({ where: { username: 'alvaro' } });
    admin = bearer(await signTestToken(app, { userId: alvaro.id, farmId }));
  }, 180_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('la inversión de cada animal es la misma en SQL y en shared', async () => {
    const allocations = await prisma.expenseAllocation.findMany({
      where: { farmId },
      select: {
        animalId: true,
        amount: true,
        voidedAt: true,
        expense: { select: { type: true, voidedAt: true } },
      },
    });
    const byAnimal = new Map<string, typeof allocations>();
    for (const row of allocations) {
      byAnimal.set(row.animalId, [...(byAnimal.get(row.animalId) ?? []), row]);
    }
    const sql = await prisma.$queryRaw<{ animal_id: string; total: string }[]>(Prisma.sql`
      WITH ${investmentCte(farmId)}
      SELECT a.id AS animal_id, COALESCE(i.total, 0)::numeric(14,2)::text AS total
        FROM animals a LEFT JOIN investment i ON i.animal_id = a.id
       WHERE a.farm_id = ${farmId}::uuid`);

    expect(sql.length).toBeGreaterThan(290);
    const differences: string[] = [];
    let withVoided = 0;
    for (const row of sql) {
      const lines = (byAnimal.get(row.animal_id) ?? []).map((allocation) => ({
        type: allocation.expense.type,
        amount: allocation.amount.toFixed(2),
        voided: allocation.voidedAt !== null || allocation.expense.voidedAt !== null,
      }));
      if (lines.some((line) => line.voided)) withVoided += 1;
      const shared = animalInvestment(lines).total;
      if (shared !== row.total) differences.push(`${row.animal_id}: SQL ${row.total} ≠ ${shared}`);
    }
    expect(differences).toEqual([]);
    // El seed tiene animales con asignaciones anuladas: la comparación las cubre.
    expect(withVoided).toBeGreaterThan(0);
  });

  it('el reporte económico del período coincide con expected.ts', async () => {
    const { period } = EXPECTED_FINANCE;
    const summary = (
      await request(app.getHttpServer())
        .get('/api/v1/finance/summary')
        .query({ from: period.from, to: period.to })
        .set(admin)
        .expect(200)
    ).body as FinanceSummary;
    expect(summary.expenses).toMatchObject({
      total: period.expensesTotal,
      general: period.expensesGeneral,
      allocated: period.expensesAllocated,
    });
    expect(summary.sales).toMatchObject({ count: period.sales, total: period.salesTotal });
    expect(summary.herd.investment).toBe(EXPECTED_FINANCE.herdInvestment);
    // La suma por categoría es la del hato, y cada venta: precio − inversión (RN-18).
    expect(summary.herd.byCategory.reduce((total, row) => total + row.animals, 0)).toBe(
      summary.herd.animals,
    );
    for (const item of summary.sales.items) {
      expect(Number(item.amount) - Number(item.investment)).toBe(Number(item.result));
    }
  });
});
