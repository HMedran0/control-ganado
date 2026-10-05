import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEFAULT_FARM_SETTINGS,
  ROLE,
  sumMoney,
  uuidv7,
  type AnimalFinance,
  type AuditPage,
  type ExpenseDetail,
  type ExpenseList,
  type ExpensePreview,
  type FinanceSummary,
  type Role,
  type SaleList,
  type SaleView,
  type ValuationView,
} from '@hato/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import {
  cleanDatabase,
  createAnimal,
  createFarm,
  createMember,
  type TestFarm,
} from './helpers/fixtures.js';

/**
 * Finanzas (M7: ECO-01 a ECO-06, RN-17, RN-18, RN-20, ADR-016) contra PostgreSQL real. Cada
 * endpoint con el ADMIN, OPERATOR y VET (403) y un ADMIN de otra finca (404 o vacío). «Hoy» es el
 * 25/09/2026.
 */
describe('Finanzas', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let lotId: string;
  /** Siete animales del lote, en orden de creación (y de id). */
  let herd: string[];

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  const createExpense = (body: Record<string, unknown>, headers = admin) =>
    http()
      .post('/api/v1/expenses')
      .set(headers)
      .send({
        type: 'FEED',
        date: '2026-09-10',
        amount: '180001',
        description: 'Bulto de sal mineralizada',
        allocation: { method: 'EQUAL', lotId },
        ...body,
      });

  const finance = async (animalId: string): Promise<AnimalFinance> =>
    (await http().get(`/api/v1/animals/${animalId}/finance`).set(admin).expect(200))
      .body as AnimalFinance;

  /** RN-17 en SQL: en todo gasto vigente con reparto, la suma de las vigentes es el monto. */
  const unbalancedExpenses = async (): Promise<number> => {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM (
        SELECT e.id
          FROM expenses e
          JOIN expense_allocations ea ON ea.expense_id = e.id AND ea.voided_at IS NULL
         WHERE e.voided_at IS NULL
         GROUP BY e.id, e.amount
        HAVING sum(ea.amount) <> e.amount) unbalanced`;
    return rows[0]?.count ?? -1;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    esperanza = await createFarm(prisma, 'La Esperanza');
    palmar = await createFarm(prisma, 'El Palmar');
    admin = bearer(
      await signTestToken(app, { userId: esperanza.userId, farmId: esperanza.farmId }),
    );
    otherAdmin = bearer(await signTestToken(app, { userId: palmar.userId, farmId: palmar.farmId }));
    operator = await as(esperanza, ROLE.OPERATOR);
    vet = await as(esperanza, ROLE.VET);
    lotId = uuidv7();
    await prisma.lot.create({ data: { id: lotId, farmId: esperanza.farmId, name: 'Paridas' } });
    herd = [];
    for (let index = 1; index <= 7; index += 1) {
      const id = await createAnimal(prisma, esperanza, { code: `${100 + index}` });
      await prisma.animal.update({ where: { id }, data: { lotId } });
      herd.push(id);
    }
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /expenses (ECO-01, ECO-02, RN-17)', () => {
    it('por lote: $180.001 entre 7, suma exacta y el residuo al menor id (ADR-016)', async () => {
      const created = (await createExpense({}).expect(201)).body as ExpenseDetail;
      expect(created).toMatchObject({
        type: 'FEED',
        amount: '180001.00',
        method: 'EQUAL',
        lot: { id: lotId, name: 'Paridas' },
        animalCount: 7,
        version: 1,
        voided: false,
      });
      expect(created.allocations.map((item) => item.animal.id)).toEqual([...herd].sort());
      expect(created.allocations[0]?.amount).toBe('25717.00');
      expect(created.allocations.slice(1).every((item) => item.amount === '25714.00')).toBe(true);
      expect(sumMoney(created.allocations.map((item) => item.amount))).toBe('180001.00');
      expect(await unbalancedExpenses()).toBe(0);

      const cow = await finance(herd[0] ?? '');
      expect(cow.investment).toEqual({
        total: '25717.00',
        byType: [{ type: 'FEED', amount: '25717.00' }],
      });
      expect(cow.lines[0]).toMatchObject({
        expenseId: created.id,
        amount: '25717.00',
        expenseAmount: '180001.00',
        animalCount: 7,
        lot: { name: 'Paridas' },
      });
    });

    it('la simulación responde 200 con el reparto y no guarda nada', async () => {
      const preview = (await createExpense({ dryRun: true }).expect(200)).body as ExpensePreview;
      expect(preview.dryRun).toBe(true);
      expect(preview.allocations).toHaveLength(7);
      expect(sumMoney(preview.allocations.map((item) => item.amount))).toBe('180001.00');
      expect(preview.allocations[0]?.animal.code).toBe('101');
      expect(await prisma.expense.count()).toBe(0);
    });

    it('por peso, por selección: proporcional, exacto y dice quién no tiene peso', async () => {
      const [a, b, c] = herd as [string, string, string];
      for (const [animalId, weightKg] of [
        [a, 293],
        [b, 307],
        [c, 311],
      ] as const) {
        await http()
          .post('/api/v1/weights')
          .set(admin)
          .send({ animalId, date: '2026-09-01', weightKg, method: 'SCALE' })
          .expect(201);
      }
      const created = (
        await createExpense({
          amount: '180001',
          allocation: { method: 'BY_WEIGHT', animalIds: [c, a, b] },
        }).expect(201)
      ).body as ExpenseDetail;
      expect(created.allocations.map((item) => item.amount)).toEqual([
        '57894.00',
        '60658.00',
        '61449.00',
      ]);
      expect(created.lot).toBeNull();

      const missing = await createExpense({
        allocation: { method: 'BY_WEIGHT', animalIds: [a, herd[3]] },
      }).expect(422);
      expect(missing.body.code).toBe('ALLOCATION_NO_WEIGHT');
      expect(missing.body.detail).toContain('104');
    });

    it('directo, general y compra: cada uno donde va', async () => {
      const direct = (
        await createExpense({
          type: 'VETERINARY',
          amount: '120000',
          allocation: { method: 'DIRECT', animalId: herd[2] },
        }).expect(201)
      ).body as ExpenseDetail;
      expect(direct).toMatchObject({ method: 'DIRECT', animalCount: 1, animal: { code: '103' } });

      const general = (
        await createExpense({
          type: 'OTHER',
          amount: '450000',
          description: 'Arreglo de la cerca',
          allocation: { method: 'GENERAL' },
        }).expect(201)
      ).body as ExpenseDetail;
      expect(general).toMatchObject({ method: 'GENERAL', animalCount: 0, allocations: [] });

      const purchase = await createExpense({ type: 'PURCHASE' }).expect(422);
      expect(purchase.body.code).toBe('EXPENSE_PURCHASE_FROM_ANIMAL');
      const future = await createExpense({ date: '2026-09-26' }).expect(422);
      expect(future.body.errors).toHaveProperty('date');
      const foreign = await createExpense(
        {
          allocation: { method: 'DIRECT', animalId: herd[0] },
        },
        otherAdmin,
      ).expect(422);
      expect(foreign.body.errors).toHaveProperty(['allocation.animalId']);
      const empty = uuidv7();
      await prisma.lot.create({ data: { id: empty, farmId: esperanza.farmId, name: 'Vacío' } });
      expect(
        (await createExpense({ allocation: { method: 'EQUAL', lotId: empty } }).expect(422)).body
          .code,
      ).toBe('ALLOCATION_EMPTY');
    });

    it('id del cliente: mismo contenido responde 200; otro contenido, CLIENT_ID_CONFLICT', async () => {
      const id = uuidv7();
      await createExpense({ id }).expect(201);
      const again = (await createExpense({ id }).expect(200)).body as ExpenseDetail;
      expect(again.id).toBe(id);
      expect(await prisma.expense.count()).toBe(1);
      expect((await createExpense({ id, amount: '1' }).expect(409)).body.code).toBe(
        'CLIENT_ID_CONFLICT',
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('PATCH /expenses/:id y POST /expenses/:id/void (ADR-016)', () => {
    it('corregir solo la descripción no cambia ninguna asignación ni las audita', async () => {
      const created = (await createExpense({}).expect(201)).body as ExpenseDetail;
      const before = await prisma.expenseAllocation.findMany({ orderBy: { id: 'asc' } });

      const edited = (
        await http()
          .patch(`/api/v1/expenses/${created.id}`)
          .set(admin)
          .send({ version: 1, description: 'Sal mineralizada 8 %' })
          .expect(200)
      ).body as ExpenseDetail;
      expect(edited).toMatchObject({ version: 2, description: 'Sal mineralizada 8 %' });

      const after = await prisma.expenseAllocation.findMany({ orderBy: { id: 'asc' } });
      expect(after.map((row) => [row.id, row.amount.toFixed(2), row.voidedAt])).toEqual(
        before.map((row) => [row.id, row.amount.toFixed(2), null]),
      );
      const log = await prisma.auditLog.findFirst({
        where: { entity: 'Expense', entityId: created.id, action: 'UPDATE' },
      });
      expect(log?.diff).toEqual({
        changed: ['description'],
        before: { description: 'Bulto de sal mineralizada' },
        after: { description: 'Sal mineralizada 8 %' },
      });
      // En la ficha del animal, la corrección aparece sin cambio de su parte.
      const page = (
        await http().get('/api/v1/audit').query({ animalId: herd[0] }).set(admin).expect(200)
      ).body as AuditPage;
      const update = page.items.find((item) => item.action === 'UPDATE');
      expect(update?.changes.map((change) => change.field)).toEqual(['description']);
    });

    it('corregir el monto anula las asignaciones y crea las nuevas, exactas y auditadas', async () => {
      const created = (await createExpense({}).expect(201)).body as ExpenseDetail;
      const edited = (
        await http()
          .patch(`/api/v1/expenses/${created.id}`)
          .set(admin)
          .send({ version: 1, amount: '190000' })
          .expect(200)
      ).body as ExpenseDetail;
      expect(edited.allocations[0]?.amount).toBe('27148.00');
      expect(sumMoney(edited.allocations.map((item) => item.amount))).toBe('190000.00');
      expect(await prisma.expenseAllocation.count({ where: { voidedAt: { not: null } } })).toBe(7);
      expect(await prisma.expenseAllocation.count({ where: { voidedAt: null } })).toBe(7);
      expect(await unbalancedExpenses()).toBe(0);
      expect((await finance(herd[0] ?? '')).investment.total).toBe('27148.00');

      // En la pestaña Cambios del animal: el monto del gasto y su parte, antes y después.
      const page = (
        await http().get('/api/v1/audit').query({ animalId: herd[0] }).set(admin).expect(200)
      ).body as AuditPage;
      const update = page.items.find((item) => item.action === 'UPDATE');
      expect(update?.entity).toBe('Expense');
      expect(update?.changes).toEqual([
        { field: 'amount', before: '180001.00', after: '190000.00' },
        { field: 'share', before: '25717.00', after: '27148.00' },
      ]);
      // Fuera de la ficha, el reparto se resume en número de animales: no cambió.
      const byEntity = (
        await http()
          .get('/api/v1/audit')
          .query({ entity: 'Expense', entityId: created.id })
          .set(admin)
          .expect(200)
      ).body as AuditPage;
      expect(byEntity.items[0]?.changes.map((change) => change.field)).toEqual(['amount']);

      const stale = await http()
        .patch(`/api/v1/expenses/${created.id}`)
        .set(admin)
        .send({ version: 1, amount: '1' })
        .expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
    });

    it('cambiar el reparto a otros animales recalcula; un animal fuera del reparto queda en cero', async () => {
      const created = (await createExpense({}).expect(201)).body as ExpenseDetail;
      const four = herd.slice(0, 4);
      const edited = (
        await http()
          .patch(`/api/v1/expenses/${created.id}`)
          .set(admin)
          .send({ version: 1, allocation: { method: 'EQUAL', animalIds: four } })
          .expect(200)
      ).body as ExpenseDetail;
      expect(edited).toMatchObject({ animalCount: 4, lot: null });
      expect(edited.allocations.map((item) => item.amount)).toEqual([
        '45001.00',
        '45000.00',
        '45000.00',
        '45000.00',
      ]);
      expect((await finance(herd[6] ?? '')).investment.total).toBe('0.00');
    });

    it('anular: el reparto deja de contar, queda auditado y anular dos veces responde 200', async () => {
      const created = (await createExpense({}).expect(201)).body as ExpenseDetail;
      const key = { 'Idempotency-Key': uuidv7() };
      const voided = (
        await http()
          .post(`/api/v1/expenses/${created.id}/void`)
          .set({ ...admin, ...key })
          .send({ reason: 'Se registró dos veces' })
          .expect(201)
      ).body as ExpenseDetail;
      expect(voided).toMatchObject({ voided: true, animalCount: 0, allocations: [] });
      await http()
        .post(`/api/v1/expenses/${created.id}/void`)
        .set({ ...admin, ...key })
        .send({ reason: 'Se registró dos veces' })
        .expect(201);
      await http()
        .post(`/api/v1/expenses/${created.id}/void`)
        .set(admin)
        .send({ reason: 'Otra vez' })
        .expect(200);
      expect(await prisma.expenseAllocation.count({ where: { voidedAt: null } })).toBe(0);
      expect((await finance(herd[0] ?? '')).investment.total).toBe('0.00');

      const page = (
        await http().get('/api/v1/audit').query({ animalId: herd[0] }).set(admin).expect(200)
      ).body as AuditPage;
      expect(page.items[0]).toMatchObject({ entity: 'Expense', action: 'VOID' });
      expect(page.items[0]?.changes).toContainEqual({
        field: 'share',
        before: '25717.00',
        after: null,
      });
      const edit = await http()
        .patch(`/api/v1/expenses/${created.id}`)
        .set(admin)
        .send({ version: 2, description: 'Nada' })
        .expect(409);
      expect(edit.body.code).toBe('EXPENSE_VOIDED');

      const list = (await http().get('/api/v1/expenses').set(admin).expect(200))
        .body as ExpenseList;
      expect(list.items).toEqual([]);
      const withVoided = (
        await http().get('/api/v1/expenses').query({ voided: 'true' }).set(admin).expect(200)
      ).body as ExpenseList;
      expect(withVoided.items[0]).toMatchObject({ id: created.id, voided: true });
    });

    it('el costo de un tratamiento y la compra siguen siendo de su animal', async () => {
      const treatment = await http()
        .post('/api/v1/treatments')
        .set(admin)
        .send({
          animalId: herd[0],
          startedOn: '2026-09-20',
          reason: 'Cojera',
          medication: 'Oxitetraciclina',
          cost: '85000',
        })
        .expect(201);
      const expense = await prisma.treatmentRecord.findUniqueOrThrow({
        where: { id: treatment.body.id as string },
      });
      const moved = await http()
        .patch(`/api/v1/expenses/${expense.expenseId ?? ''}`)
        .set(admin)
        .send({ version: 1, allocation: { method: 'DIRECT', animalId: herd[1] } })
        .expect(422);
      expect(moved.body.errors).toHaveProperty('allocation');
      await http()
        .patch(`/api/v1/expenses/${expense.expenseId ?? ''}`)
        .set(admin)
        .send({ version: 1, amount: '90000' })
        .expect(200);
      expect((await finance(herd[0] ?? '')).investment.total).toBe('90000.00');
      // Anular el tratamiento anula su gasto y sus asignaciones.
      await http()
        .post(`/api/v1/treatments/${treatment.body.id as string}/void`)
        .set(admin)
        .send({ reason: 'Era otra vaca' })
        .expect(201);
      expect((await finance(herd[0] ?? '')).investment.total).toBe('0.00');
      expect(await unbalancedExpenses()).toBe(0);
    });

    it('lista con filtros y páginas', async () => {
      await createExpense({ date: '2026-08-01', description: 'Sal de agosto' }).expect(201);
      await createExpense({ date: '2026-09-01', type: 'VACCINE', description: 'Vacuna' }).expect(
        201,
      );
      await createExpense({
        date: '2026-09-02',
        type: 'OTHER',
        description: 'Cerca',
        allocation: { method: 'GENERAL' },
      }).expect(201);
      const page1 = (
        await http().get('/api/v1/expenses').query({ limit: '2' }).set(admin).expect(200)
      ).body as ExpenseList;
      expect(page1.items.map((item) => item.description)).toEqual(['Cerca', 'Vacuna']);
      const page2 = (
        await http()
          .get('/api/v1/expenses')
          .query({ limit: '2', cursor: page1.nextCursor })
          .set(admin)
          .expect(200)
      ).body as ExpenseList;
      expect(page2.items.map((item) => item.description)).toEqual(['Sal de agosto']);
      const byAnimal = (
        await http()
          .get('/api/v1/expenses')
          .query({ animalId: herd[0], type: 'VACCINE' })
          .set(admin)
          .expect(200)
      ).body as ExpenseList;
      expect(byAnimal.items.map((item) => item.description)).toEqual(['Vacuna']);
      const search = (
        await http()
          .get('/api/v1/expenses')
          .query({ q: 'SAL', from: '2026-08-01', to: '2026-08-31' })
          .set(admin)
          .expect(200)
      ).body as ExpenseList;
      expect(search.items).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('Ventas, avalúos y resultado (ECO-03 a ECO-05)', () => {
    const sell = (animalId: string) =>
      http()
        .post(`/api/v1/animals/${animalId}/exit`)
        .set(admin)
        .send({
          type: 'SALE',
          date: '2026-09-20',
          sale: { amount: '3200000', buyer: 'Don Rafael' },
        })
        .expect(201);

    it('corregir una venta: precio y comprador, con versión y en la auditoría', async () => {
      const animal = herd[0] ?? '';
      await createExpense({
        allocation: { method: 'DIRECT', animalId: animal },
        amount: '2900000',
        type: 'OTHER',
      }).expect(201);
      await sell(animal);
      const sales = (await http().get('/api/v1/sales').set(admin).expect(200)).body as SaleList;
      const sale = sales.items[0] as SaleView;
      expect(sale).toMatchObject({ amount: '3200000.00', buyer: 'Don Rafael', version: 1 });

      const fixed = (
        await http()
          .patch(`/api/v1/sales/${sale.id}`)
          .set(admin)
          .send({ version: 1, amount: '2800000', buyer: 'Subasta de San Juan' })
          .expect(200)
      ).body as SaleView;
      expect(fixed).toMatchObject({
        amount: '2800000.00',
        buyer: 'Subasta de San Juan',
        version: 2,
      });
      expect(
        (
          await http()
            .patch(`/api/v1/sales/${sale.id}`)
            .set(admin)
            .send({ version: 1, notes: 'x' })
            .expect(409)
        ).body.code,
      ).toBe('VERSION_CONFLICT');

      const result = await finance(animal);
      expect(result.sale?.amount).toBe('2800000.00');
      expect(result.result).toEqual({ basis: 'SALE', amount: '-100000.00' });

      const page = (
        await http().get('/api/v1/audit').query({ animalId: animal }).set(admin).expect(200)
      ).body as AuditPage;
      const update = page.items.find((item) => item.entity === 'Sale' && item.action === 'UPDATE');
      expect(update?.changes).toEqual([
        { field: 'amount', before: '3200000.00', after: '2800000.00' },
        { field: 'buyer', before: 'Don Rafael', after: 'Subasta de San Juan' },
      ]);

      // Revertir la salida anula la venta: ya no se corrige.
      await http().post(`/api/v1/animals/${animal}/revert-exit`).set(admin).send({}).expect(201);
      const voided = await http()
        .patch(`/api/v1/sales/${sale.id}`)
        .set(admin)
        .send({ version: 2, notes: 'x' })
        .expect(409);
      expect(voided.body.code).toBe('SALE_VOIDED');
    });

    it('avalúo a mano y por precio por kilo; el resultado estimado sale del último', async () => {
      const animal = herd[0] ?? '';
      const manual = (
        await http()
          .post('/api/v1/valuations')
          .set(admin)
          .send({ animalId: animal, date: '2026-09-01', method: 'MANUAL', amount: '3000000' })
          .expect(201)
      ).body as ValuationView;
      expect(manual).toMatchObject({ amount: '3000000.00', method: 'MANUAL' });

      const noPrice = await http()
        .post('/api/v1/valuations')
        .set(admin)
        .send({ animalId: animal, date: '2026-09-20', method: 'PRICE_PER_KG' })
        .expect(422);
      expect(noPrice.body.code).toBe('VALUATION_NO_PRICE');
      await prisma.farm.update({
        where: { id: esperanza.farmId },
        data: {
          settings: { ...DEFAULT_FARM_SETTINGS, pricePerKgByCategory: { HEIFER: '7800.00' } },
        },
      });
      const noWeight = await http()
        .post('/api/v1/valuations')
        .set(admin)
        .send({ animalId: animal, date: '2026-09-20', method: 'PRICE_PER_KG' })
        .expect(422);
      expect(noWeight.body.code).toBe('VALUATION_NO_WEIGHT');
      await http()
        .post('/api/v1/weights')
        .set(admin)
        .send({ animalId: animal, date: '2026-09-15', weightKg: 320.5, method: 'SCALE' })
        .expect(201);
      const byWeight = (
        await http()
          .post('/api/v1/valuations')
          .set(admin)
          .send({ animalId: animal, date: '2026-09-20', method: 'PRICE_PER_KG' })
          .expect(201)
      ).body as ValuationView;
      expect(byWeight.amount).toBe('2499900.00');

      const estimate = await finance(animal);
      expect(estimate.valuations.map((item) => item.amount)).toEqual(['2499900.00', '3000000.00']);
      expect(estimate.result).toEqual({ basis: 'VALUATION', amount: '2499900.00' });

      await http()
        .post(`/api/v1/valuations/${byWeight.id}/void`)
        .set(admin)
        .send({ reason: 'Peso mal tomado' })
        .expect(201);
      await http()
        .post(`/api/v1/valuations/${byWeight.id}/void`)
        .set(admin)
        .send({ reason: 'Peso mal tomado' })
        .expect(200);
      expect((await finance(animal)).result).toEqual({ basis: 'VALUATION', amount: '3000000.00' });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('Reporte económico (ECO-06) y su exportación', () => {
    it('gastos por tipo y mes, generales aparte, inversión por categoría y ventas con resultado', async () => {
      await createExpense({}).expect(201);
      await createExpense({
        type: 'OTHER',
        amount: '450000',
        description: 'Arreglo de la cerca',
        date: '2026-08-15',
        allocation: { method: 'GENERAL' },
      }).expect(201);
      await createExpense({
        type: 'VETERINARY',
        amount: '100000',
        date: '2025-12-01',
        allocation: { method: 'DIRECT', animalId: herd[1] },
      }).expect(201);
      await http()
        .post(`/api/v1/animals/${herd[0] ?? ''}/exit`)
        .set(admin)
        .send({
          type: 'SALE',
          date: '2026-09-20',
          sale: { amount: '3200000', buyer: '=HYPERLINK("http://x","clic")' },
        })
        .expect(201);

      const summary = (await http().get('/api/v1/finance/summary').set(admin).expect(200))
        .body as FinanceSummary;
      expect(summary).toMatchObject({ from: '2026-01-01', to: '2026-09-25' });
      expect(summary.expenses).toEqual({
        total: '630001.00',
        allocated: '180001.00',
        general: '450000.00',
        byType: [
          { type: 'FEED', amount: '180001.00' },
          { type: 'OTHER', amount: '450000.00' },
        ],
        byMonth: [
          { month: '2026-08', amount: '450000.00' },
          { month: '2026-09', amount: '180001.00' },
        ],
      });
      expect(summary.herd).toEqual({
        animals: 6,
        // Los seis activos: 25.714 cada uno, más los 100.000 del veterinario de 2025.
        investment: '254284.00',
        byCategory: [{ category: 'HEIFER', animals: 6, investment: '254284.00' }],
      });
      expect(summary.sales).toMatchObject({
        count: 1,
        total: '3200000.00',
        investment: '25717.00',
        result: '3174283.00',
      });

      const response = await http()
        .get('/api/v1/finance/summary/export.xlsx')
        .query({ from: '2026-01-01', to: '2026-09-25' })
        .set(admin)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-disposition']).toContain(
        'reporte-economico-2026-01-01-a-2026-09-25.xlsx',
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ArrayBuffer);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'Resumen',
        'Inversión por categoría',
        'Gastos por tipo',
        'Gastos por mes',
        'Ventas',
      ]);
      const sales = workbook.getWorksheet('Ventas');
      const row = sales?.getRow(2);
      // El comprador con forma de fórmula llega como texto, con el apóstrofo delante (M4d).
      expect(row?.getCell(4).value).toBe('\'=HYPERLINK("http://x","clic")');
      expect(row?.getCell(4).formula).toBeUndefined();
      expect(row?.getCell(5).value).toBe(3200000);
      expect(row?.getCell(7).value).toBe(3174283);
      expect(workbook.getWorksheet('Resumen')?.getRow(4).getCell(2).value).toBe(630001);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('Autorización (RN-20) y aislamiento por finca', () => {
    it('OPERATOR y VET reciben 403 en cada ruta de finanzas; otra finca, 404 o vacío', async () => {
      const expense = (await createExpense({}).expect(201)).body as ExpenseDetail;
      await http()
        .post(`/api/v1/animals/${herd[0] ?? ''}/exit`)
        .set(admin)
        .send({ type: 'SALE', date: '2026-09-20', sale: { amount: '3200000' } })
        .expect(201);
      const sale = ((await http().get('/api/v1/sales').set(admin).expect(200)).body as SaleList)
        .items[0] as SaleView;
      const valuation = (
        await http()
          .post('/api/v1/valuations')
          .set(admin)
          .send({ animalId: herd[1], date: '2026-09-20', method: 'MANUAL', amount: '1' })
          .expect(201)
      ).body as ValuationView;

      const routes: [string, string, object?][] = [
        ['get', '/api/v1/expenses'],
        ['get', `/api/v1/expenses/${expense.id}`],
        [
          'post',
          '/api/v1/expenses',
          {
            type: 'FEED',
            date: '2026-09-10',
            amount: '1',
            description: 'abc',
            allocation: { method: 'GENERAL' },
          },
        ],
        ['patch', `/api/v1/expenses/${expense.id}`, { version: 1, description: 'abcd' }],
        ['post', `/api/v1/expenses/${expense.id}/void`, { reason: 'abc' }],
        ['get', '/api/v1/sales'],
        ['patch', `/api/v1/sales/${sale.id}`, { version: 1, notes: 'x' }],
        [
          'post',
          '/api/v1/valuations',
          { animalId: herd[1], date: '2026-09-20', method: 'MANUAL', amount: '1' },
        ],
        ['post', `/api/v1/valuations/${valuation.id}/void`, { reason: 'abc' }],
        ['get', `/api/v1/animals/${herd[1] ?? ''}/finance`],
        ['get', '/api/v1/finance/summary'],
        ['get', '/api/v1/finance/summary/export.xlsx'],
      ];
      for (const headers of [operator, vet]) {
        for (const [method, path, body] of routes) {
          const call = http()[method as 'get'](path).set(headers);
          const response = await (body === undefined ? call : call.send(body));
          expect([path, response.status]).toEqual([path, 403]);
        }
      }

      // Otra finca: lo de La Esperanza no existe para El Palmar.
      for (const [method, path, body] of routes.filter(([, path]) =>
        /[0-9a-f]{8}-[0-9a-f]{4}/.test(path),
      )) {
        const call = http()[method as 'get'](path).set(otherAdmin);
        const response = await (body === undefined ? call : call.send(body));
        expect([path, response.status]).toEqual([path, 404]);
      }
      const foreignList = (await http().get('/api/v1/expenses').set(otherAdmin).expect(200))
        .body as ExpenseList;
      expect(foreignList.items).toEqual([]);
      const foreignSales = (await http().get('/api/v1/sales').set(otherAdmin).expect(200))
        .body as SaleList;
      expect(foreignSales.items).toEqual([]);
      const foreignSummary = (
        await http().get('/api/v1/finance/summary').set(otherAdmin).expect(200)
      ).body as FinanceSummary;
      expect(foreignSummary.expenses.total).toBe('0.00');
      expect(foreignSummary.sales.count).toBe(0);
    });
  });
});
