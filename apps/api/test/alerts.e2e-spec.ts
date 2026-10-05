import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ANIMAL_ALERT, type AlertsResponse, type AnimalAlert, type AnimalList } from '@hato/shared';
import request from 'supertest';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm } from './helpers/fixtures.js';

/**
 * Página de Alertas (M6) sobre la finca de referencia, el 25/09/2026. Los conteos salen del mismo
 * SQL que el filtro `alerts` del listado: cada uno coincide con el total de `GET /animals`
 * filtrado por esa alerta. Todos los roles la ven; un usuario de otra finca no ve nada de esta.
 */
describe('GET /alerts', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let levanteLot: string;

  const http = () => request(app.getHttpServer());
  const alerts = async (headers: Record<string, string>, query = '') =>
    (await http().get(`/api/v1/alerts${query}`).set(headers).expect(200)).body as AlertsResponse;
  const listTotal = async (query: string) =>
    ((await http().get(`/api/v1/animals?${query}`).set(admin).expect(200)).body as AnimalList)
      .total;

  beforeAll(async () => {
    const created = await createTestAppWithClock();
    app = created.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const { seed } = await runReferenceSeed(prisma, {
      password: 'contraseña-de-prueba-del-seed',
      today: SEED_TODAY,
    });
    const farmId = seed.catalog.farmId;
    const token = async (username: string) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username } });
      return bearer(await signTestToken(app, { userId: user.id, farmId }));
    };
    admin = await token('alvaro');
    operator = await token('wilmer');
    vet = await token('paola.vet');
    const other = await createFarm(prisma, 'Otra finca');
    otherAdmin = bearer(await signTestToken(app, { userId: other.userId, farmId: other.farmId }));
    levanteLot = (await prisma.lot.findFirstOrThrow({ where: { farmId, name: 'Levante' } })).id;
  }, 180_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('cada conteo coincide con el listado filtrado por esa alerta', async () => {
    const body = await alerts(admin);
    for (const alert of Object.values(ANIMAL_ALERT)) {
      expect(body.counts[alert], alert).toBe(await listTotal(`alerts=${alert}`));
    }
    // La finca de referencia tiene casos de todos los grupos (08 §3.2, expected.ts).
    expect(body.counts.vaccine_overdue).toBeGreaterThan(0);
    expect(body.counts.calving_overdue).toBe(2);
    expect(body.counts.withdrawal).toBe(2);
    expect(body.counts.low_gain).toBeGreaterThan(0);
    expect(body.counts.weight_loss).toBeGreaterThan(0);
  });

  it('varios tipos se combinan con «o»; el total cuenta animales, no alertas', async () => {
    const types: AnimalAlert[] = ['withdrawal', 'calving_overdue'];
    const body = await alerts(operator, `?types=${types.join(',')}`);
    expect(body.total).toBe(4);
    expect(body.items.every((item) => item.alerts.some((alert) => types.includes(alert)))).toBe(
      true,
    );
    const withdrawal = body.items.find((item) => item.alerts.includes('withdrawal'));
    expect(withdrawal?.withdrawals.meatUntil).not.toBeNull();
    const overdue = body.items.find((item) => item.alerts.includes('calving_overdue'));
    expect(overdue?.pregnancy?.expectedCalvingDate).toBeDefined();
  });

  it('el filtro de lote se aplica a la lista y a los conteos', async () => {
    const body = await alerts(vet, `?lotId=${levanteLot}&types=low_gain,weight_loss`);
    expect(body.items.every((item) => item.lot?.id === levanteLot)).toBe(true);
    expect(body.counts.low_gain).toBe(await listTotal(`alerts=low_gain&lotId=${levanteLot}`));
    expect(body.items[0]?.weight).not.toBeNull();
    // En el lote de levante no hay partos.
    expect(body.counts.calving_soon).toBe(0);
  });

  it('las vacunas de cada fila son solo las vencidas, pendientes o próximas', async () => {
    const body = await alerts(admin, '?types=vaccine_overdue&limit=10');
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.vaccines.some((vaccine) => vaccine.status === 'OVERDUE')).toBe(true);
      expect(item.vaccines.every((vaccine) => vaccine.status !== 'UP_TO_DATE')).toBe(true);
    }
    expect(body.nextCursor === null || body.items.length === 10).toBe(true);
  });

  it('otra finca: sin alertas de esta; tipo desconocido, 422', async () => {
    const body = await alerts(otherAdmin);
    expect(body.total).toBe(0);
    expect(Object.values(body.counts).every((count) => count === 0)).toBe(true);
    await http().get('/api/v1/alerts?types=desconocida').set(admin).expect(422);
  });
});
