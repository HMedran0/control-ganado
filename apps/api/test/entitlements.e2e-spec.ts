import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@hato/shared';
import request from 'supertest';

import {
  EntitlementsService,
  PILOT_PLAN,
  PLAN_FEATURE,
  PLAN_LIMIT,
  PLAN_RESOLVER,
  type Plan,
} from '../src/common/entitlements/entitlements.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, type TestFarm } from './helpers/fixtures.js';

/**
 * Límites por plan en un solo punto (ADR-013):
 *
 * - con el plan PILOT todo se permite;
 * - el alta de animal y la importación llaman a `checkLimit(ANIMALS, n)`;
 * - con un plan de prueba con límite, los dos puntos responden `PLAN_LIMIT_REACHED` y no se
 *   guarda nada.
 */

const csv = (rows: readonly string[]): Buffer =>
  Buffer.from(['Código;Sexo;Raza;Fecha de nacimiento', ...rows].join('\n'), 'utf8');

const THREE_ROWS = [
  '10;Hembra;Brahman;01/01/2022',
  '11;Macho;Brahman;01/01/2023',
  '12;Hembra;Brahman;01/01/2021',
];

const confirmImport = (
  app: NestFastifyApplication,
  headers: Record<string, string>,
  data: Buffer,
) =>
  request(app.getHttpServer())
    .post('/api/v1/imports/animals')
    .set(headers)
    .field('importKey', uuidv7())
    .attach('file', data, { filename: 'inventario.csv', contentType: 'text/csv' });

const animal = (farm: TestFarm, code: string) => ({
  code,
  sex: 'FEMALE',
  breedId: farm.breedId,
  birthDate: '2024-03-01',
  origin: 'BORN_ON_FARM',
});

describe('EntitlementsService con el plan PILOT (ADR-013)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let admin: Record<string, string>;

  beforeAll(async () => {
    ({ app } = await createTestAppWithClock());
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'La Esperanza');
    admin = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
  });

  it('todo se permite: cualquier cantidad y todos los módulos', async () => {
    const entitlements = app.get(EntitlementsService);
    await expect(
      entitlements.checkLimit(farm.farmId, PLAN_LIMIT.ANIMALS, 1_000_000),
    ).resolves.toBeUndefined();
    await expect(
      entitlements.checkLimit(farm.farmId, PLAN_LIMIT.USERS, 500),
    ).resolves.toBeUndefined();
    expect(await entitlements.can(farm.farmId, PLAN_FEATURE.MILK)).toBe(true);
    expect(await entitlements.can(farm.farmId, PLAN_FEATURE.LIVE_SCALE)).toBe(true);
    expect(PILOT_PLAN.limits).toEqual({});
  });

  it('el alta de animal llama a checkLimit(ANIMALS, 1)', async () => {
    const spy = vi.spyOn(app.get(EntitlementsService), 'checkLimit');
    await request(app.getHttpServer())
      .post('/api/v1/animals')
      .set(admin)
      .send(animal(farm, '1'))
      .expect(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(farm.farmId, PLAN_LIMIT.ANIMALS, 1, expect.anything());
  });

  it('la importación llama a checkLimit(ANIMALS, filas que entran)', async () => {
    const spy = vi.spyOn(app.get(EntitlementsService), 'checkLimit');
    await confirmImport(app, admin, csv(THREE_ROWS)).expect(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(farm.farmId, PLAN_LIMIT.ANIMALS, 3, expect.anything());
  });
});

describe('EntitlementsService con un plan de prueba con límite (ADR-013)', () => {
  const LIMITED: Plan = { name: 'PRUEBA', limits: { ANIMALS: 2 }, features: new Set() };
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let admin: Record<string, string>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app } = await createTestAppWithClock({}, undefined, (builder) =>
      builder.overrideProvider(PLAN_RESOLVER).useValue(() => LIMITED),
    ));
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'La Esperanza');
    admin = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
  });

  it('el alta de animal responde PLAN_LIMIT_REACHED al pasar el límite', async () => {
    await http().post('/api/v1/animals').set(admin).send(animal(farm, '1')).expect(201);
    await http().post('/api/v1/animals').set(admin).send(animal(farm, '2')).expect(201);
    const response = await http()
      .post('/api/v1/animals')
      .set(admin)
      .send(animal(farm, '3'))
      .expect(403);
    expect(response.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      detail: 'Tu plan no permite más animales.',
    });
    expect(await prisma.animal.count()).toBe(2);
  });

  it('los animales que salieron no cuentan para el límite', async () => {
    const first = await http()
      .post('/api/v1/animals')
      .set(admin)
      .send(animal(farm, '1'))
      .expect(201);
    await http().post('/api/v1/animals').set(admin).send(animal(farm, '2')).expect(201);
    await http()
      .post(`/api/v1/animals/${first.body.id as string}/exit`)
      .set(admin)
      .send({ type: 'DEATH', date: '2026-09-20' })
      .expect(201);
    await http().post('/api/v1/animals').set(admin).send(animal(farm, '3')).expect(201);
  });

  it('la importación que pasaría el límite no importa nada', async () => {
    const response = await confirmImport(app, admin, csv(THREE_ROWS)).expect(403);
    expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(await prisma.animal.count()).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
  });

  it('can() respeta los módulos del plan', async () => {
    expect(await app.get(EntitlementsService).can(farm.farmId, PLAN_FEATURE.MILK)).toBe(false);
  });
});
