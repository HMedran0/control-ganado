import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEFAULT_FARM_SETTINGS,
  ROLE,
  uuidv7,
  type AnimalDetail,
  type ExpenseDetail,
  type Role,
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
import { EXPORTABLE_REPORTS } from '../src/reports/reports-export.service.js';

/**
 * Barrido de RN-20 (M7): quien no es ADMIN nunca recibe montos, ni en campos anidados.
 *
 * Un ADMIN siembra una finca con datos económicos de montos centinela (compra, venta, gastos,
 * avalúo, costo de un tratamiento). Después, como OPERATOR y como VET, la prueba llama **todas** las
 * rutas `GET` registradas en Nest (las descubre en tiempo de ejecución, así que una ruta nueva entra
 * sola) y una lista de escrituras que esos roles sí pueden hacer, y revisa cada respuesta:
 *
 * - en JSON, recorre el cuerpo completo y falla si aparece una clave de dinero o un monto
 *   centinela en cualquier valor;
 * - en Excel, revisa los encabezados y cada celda de cada hoja.
 *
 * Si aparece una ruta `GET` con un parámetro que la prueba no sabe llenar, falla: hay que
 * agregarla aquí, no dejarla sin revisar.
 */

/** Claves que solo puede recibir un ADMIN (RN-20), en cualquier nivel del cuerpo. */
const MONEY_KEYS = new Set([
  'amount',
  'price',
  'purchasePrice',
  'pricePerKgByCategory',
  'cost',
  'investment',
  'economics',
  'valuation',
  'valuations',
  'sale',
  'sales',
  'result',
  'share',
  'expenseAmount',
  'expenses',
]);

/** Encabezados de Excel con dinero. */
const MONEY_HEADER = /valor|precio|monto|inversi|costo|resultado|aval|gasto|venta \(\$\)/i;

/** Montos centinela: no se parecen a ningún peso, edad ni conteo de la finca. */
const SENTINELS = {
  purchase: '9876543',
  sale: '8765432',
  expense: '7654321',
  valuation: '6543210',
  treatment: '5432109',
};

type Route = { readonly method: 'GET' | 'POST' | 'PATCH'; readonly path: string };

describe('RN-20: ningún monto para quien no es ADMIN', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());

  const as = async (role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'Finca del barrido');
    await prisma.farm.update({
      where: { id: farm.farmId },
      data: {
        settings: {
          ...DEFAULT_FARM_SETTINGS,
          pricePerKgByCategory: {
            COW: `${SENTINELS.valuation}.00`,
            HEIFER: `${SENTINELS.valuation}.00`,
          },
        },
      },
    });
    admin = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
    operator = await as(ROLE.OPERATOR);
    vet = await as(ROLE.VET);
    await seedEconomics();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  /** Una finca pequeña con cada dato económico, registrado por el ADMIN. */
  async function seedEconomics(): Promise<void> {
    ids.lot = uuidv7();
    await prisma.lot.create({ data: { id: ids.lot, farmId: farm.farmId, name: 'Paridas' } });
    ids.vaccine = uuidv7();
    await prisma.vaccine.create({
      data: {
        id: ids.vaccine,
        farmId: farm.farmId,
        name: 'Aftosa',
        disease: 'Aftosa',
        defaultDose: '2 ml',
        scheduleType: 'OFFICIAL_CYCLE',
      },
    });
    ids.cycle = uuidv7();
    await prisma.vaccinationCycle.create({
      data: {
        id: ids.cycle,
        farmId: farm.farmId,
        name: '2026-2',
        startsOn: new Date('2026-09-01T00:00:00Z'),
        endsOn: new Date('2026-10-31T00:00:00Z'),
      },
    });

    const cow = (
      await http()
        .post('/api/v1/animals')
        .set(admin)
        .send({
          code: '087',
          name: 'Canela',
          sex: 'FEMALE',
          breedId: farm.breedId,
          birthDate: '2020-03-01',
          origin: 'PURCHASED',
          entryDate: '2022-01-15',
          purchasePrice: SENTINELS.purchase,
          lotId: ids.lot,
          initialWeight: { weightKg: 450, weighedOn: '2026-09-01' },
        })
        .expect(201)
    ).body as AnimalDetail;
    ids.animal = cow.id;
    ids.sold = await createAnimal(prisma, farm, { code: '140', sex: 'MALE' });
    await prisma.animal.update({ where: { id: ids.sold }, data: { lotId: ids.lot } });

    const expense = (
      await http()
        .post('/api/v1/expenses')
        .set(admin)
        .send({
          type: 'FEED',
          date: '2026-09-10',
          amount: SENTINELS.expense,
          description: 'Sal mineralizada',
          allocation: { method: 'EQUAL', lotId: ids.lot },
        })
        .expect(201)
    ).body as ExpenseDetail;
    ids.expense = expense.id;
    await http()
      .post('/api/v1/treatments')
      .set(admin)
      .send({
        animalId: ids.animal,
        startedOn: '2026-09-20',
        reason: 'Mastitis',
        medication: 'Oxitetraciclina',
        cost: SENTINELS.treatment,
      })
      .expect(201);
    await http()
      .post('/api/v1/valuations')
      .set(admin)
      .send({ animalId: ids.animal, date: '2026-09-20', method: 'PRICE_PER_KG' })
      .expect(201);
    await http()
      .post('/api/v1/vaccinations')
      .set(admin)
      .send({ animalId: ids.animal, vaccineId: ids.vaccine, date: '2026-09-15' })
      .expect(201);
    const pregnancy = await http()
      .post('/api/v1/pregnancies')
      .set(admin)
      .send({ damId: ids.animal, serviceDate: '2026-06-01', method: 'AI' })
      .expect(201);
    ids.pregnancy = pregnancy.body.id as string;
    await http()
      .post(`/api/v1/animals/${ids.sold}/exit`)
      .set(admin)
      .send({
        type: 'SALE',
        date: '2026-09-22',
        sale: { amount: SENTINELS.sale, buyer: 'Don Rafael' },
      })
      .expect(201);
  }

  /** Las rutas registradas en Nest, con el prefijo global. */
  function registeredRoutes(): Route[] {
    const methods: Partial<Record<RequestMethod, Route['method']>> = {
      [RequestMethod.GET]: 'GET',
      [RequestMethod.POST]: 'POST',
      [RequestMethod.PATCH]: 'PATCH',
    };
    const routes: Route[] = [];
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
        if (controller === null) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const method = methods[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          if (method === undefined || path === undefined) continue;
          const full = ['api/v1', base, path].filter((part) => part !== '' && part !== '/');
          routes.push({ method, path: `/${full.join('/')}`.replace(/\/+/g, '/') });
        }
      }
    }
    return routes;
  }

  /** Llena los parámetros con datos de la finca. Una ruta desconocida hace fallar la prueba. */
  function fill(path: string): string[] {
    if (!path.includes(':')) return [path];
    // M8b: cada reporte exportable en Excel (el de salidas trae precios para el ADMIN).
    if (path === '/api/v1/reports/:name/export') {
      return EXPORTABLE_REPORTS.map((name) =>
        name === 'cycle-progress'
          ? `/api/v1/reports/${name}/export?cycleId=${ids.cycle ?? ''}`
          : `/api/v1/reports/${name}/export?from=2024-01-01`,
      );
    }
    const byPrefix: [RegExp, string[]][] = [
      [/^\/api\/v1\/animals\/:id/, [ids.animal ?? '', ids.sold ?? '']],
      [/^\/api\/v1\/expenses\/:id/, [ids.expense ?? '']],
      [/^\/api\/v1\/lots\/:id/, [ids.lot ?? '']],
      [/^\/api\/v1\/pregnancies\/:id/, [ids.pregnancy ?? '']],
      [/^\/api\/v1\/vaccination-cycles\/:id/, [ids.cycle ?? '']],
      [/^\/api\/v1\/vaccines\/:id/, [ids.vaccine ?? '']],
    ];
    const match = byPrefix.find(([pattern]) => pattern.test(path));
    if (match === undefined) throw new Error(`El barrido no sabe llenar ${path}: agrégala.`);
    return match[1].map((id) => path.replace(':id', id));
  }

  /** Consulta por defecto de las rutas que la necesitan para responder algo útil. */
  const QUERY: Readonly<Record<string, Record<string, string>>> = {
    '/api/v1/animals/search': { q: '087' },
    '/api/v1/animals': { status: 'all' },
    '/api/v1/animals/export.xlsx': {},
    '/api/v1/animals/labels': { ids: '' },
  };

  /** Recorre el cuerpo y devuelve dónde hay dinero. */
  function moneyIn(value: unknown, path = '$'): string[] {
    if (Array.isArray(value))
      return value.flatMap((item, index) => moneyIn(item, `${path}[${index}]`));
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([key, child]) => [
        ...(MONEY_KEYS.has(key) ? [`${path}.${key}`] : []),
        ...moneyIn(child, `${path}.${key}`),
      ]);
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value);
      return Object.values(SENTINELS).some((sentinel) => text.includes(sentinel))
        ? [`${path} = ${text}`]
        : [];
    }
    return [];
  }

  async function moneyInWorkbook(data: Buffer): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
    const found: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, column) => {
          const text = cell.text;
          if (rowNumber === 1 && MONEY_HEADER.test(text)) {
            found.push(`${sheet.name}!${column}1 = ${text}`);
          }
          if (Object.values(SENTINELS).some((sentinel) => text.includes(sentinel))) {
            found.push(`${sheet.name}!${column}${rowNumber} = ${text}`);
          }
        });
      });
    });
    return found;
  }

  async function sweep(headers: Record<string, string>, route: Route, body?: object) {
    const call =
      route.method === 'GET'
        ? http()
            .get(route.path)
            .query(QUERY[route.path] ?? {})
        : route.method === 'POST'
          ? http().post(route.path)
          : http().patch(route.path);
    const response = await call
      .set(headers)
      .send(body ?? {})
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const data = response.body as Buffer;
    const type = String(response.headers['content-type'] ?? '');
    if (type.includes('spreadsheetml'))
      return { status: response.status, leaks: await moneyInWorkbook(data) };
    const text = data.toString('utf8');
    const leaks = type.includes('json') ? moneyIn(JSON.parse(text)) : moneyIn(text);
    return { status: response.status, leaks };
  }

  it('las rutas descubiertas incluyen las de finanzas y la ficha', () => {
    const paths = registeredRoutes().map((route) => `${route.method} ${route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /api/v1/animals/:id',
        'GET /api/v1/animals/:id/finance',
        'GET /api/v1/expenses',
        'GET /api/v1/finance/summary/export.xlsx',
        'GET /api/v1/audit',
        'PATCH /api/v1/sales/:id',
        'GET /api/v1/dashboard',
        'GET /api/v1/export/full',
      ]),
    );
  });

  it('M8b: la exportación completa (con todos los montos) es solo del ADMIN', async () => {
    for (const headers of [operator, vet]) {
      const { status, leaks } = await sweep(headers, { method: 'GET', path: '/api/v1/export/full' });
      expect(status).toBe(403);
      expect(leaks).toEqual([]);
    }
  });

  it.each([
    ['OPERATOR', () => operator],
    ['VET', () => vet],
  ])('%s: ninguna respuesta GET trae montos, ni anidados ni en Excel', async (_role, headers) => {
    // El ADMIN sí los recibe: la prueba sabe reconocerlos.
    const own = await sweep(admin, {
      method: 'GET',
      path: `/api/v1/animals/${ids.animal ?? ''}/finance`,
    });
    expect(own.leaks.length).toBeGreaterThan(0);
    // M8a: el tablero del ADMIN trae la inversión del hato; el barrido la reconoce.
    const board = await sweep(admin, { method: 'GET', path: '/api/v1/dashboard' });
    expect(board.leaks.length).toBeGreaterThan(0);
    // M8b: las salidas en JSON y en Excel traen el precio de venta para el ADMIN.
    const exits = await sweep(admin, { method: 'GET', path: '/api/v1/reports/exits?from=2024-01-01' });
    expect(exits.leaks.length).toBeGreaterThan(0);
    const exitsFile = await sweep(admin, {
      method: 'GET',
      path: '/api/v1/reports/exits/export?from=2024-01-01',
    });
    expect(exitsFile.leaks.length).toBeGreaterThan(0);

    const results: string[] = [];
    let checked = 0;
    for (const route of registeredRoutes().filter((item) => item.method === 'GET')) {
      for (const path of fill(route.path)) {
        const { status, leaks } = await sweep(headers(), { method: 'GET', path });
        checked += 1;
        expect(status, path).toBeLessThan(500);
        if (leaks.length > 0) results.push(`${path} (${status}): ${leaks.join(', ')}`);
      }
    }
    expect(checked).toBeGreaterThan(35);
    expect(results).toEqual([]);
  });

  it.each([
    ['OPERATOR', () => operator],
    ['VET', () => vet],
  ])(
    '%s: las escrituras que puede hacer, y las que no, tampoco devuelven montos',
    async (_role, headers) => {
      const writes: [Route, object][] = [
        [
          { method: 'POST', path: '/api/v1/animals' },
          {
            code: uuidv7().slice(-6),
            sex: 'FEMALE',
            breedId: farm.breedId,
            birthDate: '2026-01-10',
            origin: 'BORN_ON_FARM',
            lotId: ids.lot,
          },
        ],
        [
          { method: 'PATCH', path: `/api/v1/animals/${ids.animal ?? ''}` },
          { version: 99, notes: 'x' },
        ],
        [
          { method: 'POST', path: '/api/v1/weights' },
          { animalId: ids.animal, date: '2026-09-24', weightKg: 452, method: 'TAPE' },
        ],
        [
          { method: 'POST', path: '/api/v1/vaccinations' },
          { animalId: ids.animal, vaccineId: ids.vaccine, date: '2026-09-24' },
        ],
        [
          { method: 'POST', path: '/api/v1/vaccinations/bulk' },
          { vaccineId: ids.vaccine, date: '2026-09-24', lotId: ids.lot, dryRun: true },
        ],
        [
          { method: 'POST', path: '/api/v1/treatments' },
          {
            animalId: ids.animal,
            startedOn: '2026-09-24',
            reason: 'Cojera',
            medication: 'Penicilina',
          },
        ],
        [
          { method: 'POST', path: `/api/v1/pregnancies/${ids.pregnancy ?? ''}/diagnosis` },
          { date: '2026-09-24', result: 'POSITIVE' },
        ],
        [
          { method: 'POST', path: '/api/v1/animals/bulk/tags' },
          { animalIds: [ids.animal], forSale: true },
        ],
        [
          { method: 'POST', path: '/api/v1/animals/bulk/lot' },
          { animalIds: [ids.animal], lotId: ids.lot },
        ],
        // Las de finanzas y la salida: 403, y el error tampoco trae montos.
        [
          { method: 'POST', path: `/api/v1/animals/${ids.animal ?? ''}/exit` },
          { type: 'SALE', date: '2026-09-24', sale: { amount: '1' } },
        ],
        [
          { method: 'POST', path: '/api/v1/expenses' },
          {
            type: 'FEED',
            date: '2026-09-24',
            amount: '1',
            description: 'abc',
            allocation: { method: 'GENERAL' },
          },
        ],
        [
          { method: 'PATCH', path: `/api/v1/expenses/${ids.expense ?? ''}` },
          { version: 1, description: 'abcd' },
        ],
        [
          { method: 'POST', path: '/api/v1/valuations' },
          { animalId: ids.animal, date: '2026-09-24', method: 'MANUAL', amount: '1' },
        ],
      ];
      const results: string[] = [];
      for (const [route, body] of writes) {
        const { status, leaks } = await sweep(headers(), route, body);
        expect(status, route.path).toBeLessThan(500);
        if (leaks.length > 0)
          results.push(`${route.method} ${route.path} (${status}): ${leaks.join(', ')}`);
      }
      expect(results).toEqual([]);
    },
  );
});
