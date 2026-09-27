import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, type TestFarm } from './helpers/fixtures.js';
import { ProbeController } from './helpers/probe.controller.js';

/**
 * El interceptor de auditoría registra las escrituras exitosas en `audit_logs`
 * (04-arquitectura.md §4, RNF-14). Las que fallan no dejan rastro: la auditoría cuenta lo que
 * pasó, no lo que se intentó.
 */
describe('AuditInterceptor', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let headers: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'Finca de auditoría');
    headers = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
  });

  it('registra una escritura exitosa con entidad, acción, finca y usuario', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe/breeds')
      .set(headers)
      .send({ name: 'Gyr' })
      .expect(201);

    await waitForAuditRows(prisma, 1);
    const logs = await prisma.auditLog.findMany();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      farmId: farm.farmId,
      userId: farm.userId,
      entity: 'Breed',
      entityId: response.body.id,
      action: 'CREATE',
    });
    expect(logs[0]?.diff).toMatchObject({ name: 'Gyr' });
  });

  it('no registra nada si la escritura falla', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/probe/breeds/failing')
      .set(headers)
      .send({ name: 'No se crea' })
      .expect(409);

    // Se espera un momento para descartar una escritura tardía del interceptor.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('no registra las lecturas', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe/scope').set(headers).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

/** Espera a que el interceptor termine de escribir: registra en segundo plano, sin bloquear. */
async function waitForAuditRows(prisma: PrismaService, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await prisma.auditLog.count()) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`La auditoría no registró ${expected} fila(s) en el tiempo esperado.`);
}
