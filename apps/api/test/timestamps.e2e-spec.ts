import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7, type SessionView } from '@hato/shared';
import { Client } from 'pg';
import request from 'supertest';

import { PasswordService } from '../src/auth/password.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, type FakeClock } from './helpers/app.js';
import { cleanDatabase, createAnimal, createFarm, type TestFarm } from './helpers/fixtures.js';
import { testDatabaseUrl } from './test-env.js';

/**
 * Las marcas de tiempo (`timestamptz`) conservan la hora exacta al pasar por la API, aunque la
 * zona por defecto de las sesiones de PostgreSQL no sea UTC.
 *
 * Es el error de M5: el adaptador de Prisma envía y lee las marcas sin desfase, y con la sesión
 * en `America/Bogota` (el contenedor local tiene `PGTZ`) se guardaban cinco horas corridas y el
 * `now()` del trigger `set_updated_at()` se leía cinco horas antes. La API abre sus conexiones con
 * `TimeZone=UTC` (`src/infra/db-session.ts`); esta prueba falla si eso se pierde.
 *
 * La base de pruebas tiene `TimeZone = America/Bogota` por defecto (`global-setup.ts`), y la
 * primera prueba lo verifica: si el entorno no reprodujera el riesgo, las demás pasarían en vano.
 * `pnpm test:tz` la corre además con `TZ` de Bogotá y de Tokio, y la integración continua con
 * `PGTZ=America/Bogota`.
 */

const PASSWORD = 'clave-de-prueba-123';
/** Diferencia tolerada entre el reloj del contenedor de la base y el del proceso de pruebas. */
const CLOCK_SKEW_MS = 5_000;

describe('Marcas de tiempo con la sesión de PostgreSQL fuera de UTC', () => {
  let app: NestFastifyApplication;
  let clock: FakeClock;
  let prisma: PrismaService;
  let farm: TestFarm;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, clock } = await createTestAppWithClock());
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'Finca de marcas de tiempo');
    await prisma.user.create({
      data: {
        id: uuidv7(),
        name: 'Álvaro',
        username: 'alvaro.tz',
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        memberships: { create: { id: uuidv7(), farmId: farm.farmId, role: ROLE.ADMIN } },
      },
    });
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('una sesión sin opciones abre en la zona de Bogotá; la de la API, en UTC', async () => {
    const raw = new Client({ connectionString: testDatabaseUrl() });
    await raw.connect();
    try {
      const { rows } = await raw.query<{ TimeZone: string }>('SHOW "TimeZone"');
      expect(rows[0]?.TimeZone).toBe('America/Bogota');
    } finally {
      await raw.end();
    }

    const [api] = await prisma.$queryRaw<{ TimeZone: string }[]>`SHOW "TimeZone"`;
    expect(api?.TimeZone).toBe('UTC');
  });

  it('el inicio de sesión que escribe la API se lee con la hora exacta', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ login: 'alvaro.tz', password: PASSWORD })
      .expect(201);
    const { accessToken } = login.body as { accessToken: string };

    const sessions = await http().get('/api/v1/auth/sessions').set(bearer(accessToken)).expect(200);
    const [session] = (sessions.body as { items: SessionView[] }).items;

    // El reloj falso fija el instante del inicio de sesión: la ida y la vuelta no lo mueven.
    expect(session?.startedAt).toBe(clock.now().toISOString());

    // Y la base guarda ese mismo instante, medido en segundos desde 1970 sin pasar por Prisma.
    const [stored] = await prisma.$queryRaw<{ epoch: number }[]>`
      SELECT extract(epoch FROM family_started_at)::float8 AS epoch FROM refresh_tokens LIMIT 1`;
    expect(Number(stored?.epoch) * 1000).toBe(clock.now().getTime());
  });

  it('el now() del trigger se lee como el instante real', async () => {
    const id = await createAnimal(prisma, farm, { code: 'TZ-1' });

    const before = Date.now();
    await prisma.$executeRaw`UPDATE animals SET notes = 'cambio por SQL' WHERE id = ${id}::uuid`;
    const after = Date.now();

    const { updatedAt } = await prisma.animal.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before - CLOCK_SKEW_MS);
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after + CLOCK_SKEW_MS);
  });
});
