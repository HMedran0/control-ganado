import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, type TestFarm } from './helpers/fixtures.js';

/**
 * Defensas de borde: cabeceras seguras, CORS y límite de peticiones
 * (04-arquitectura.md §5, RNF-08).
 *
 * El límite se prueba con una aplicación aparte y un tope diminuto: con el real (60 por
 * minuto) habría que hacer sesenta peticiones para ver el rechazo.
 */
describe('Defensas de borde', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;

  beforeAll(async () => {
    ({ app } = await createTestAppWithClock({}, { perUser: 3, perIp: 3 }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'Finca de seguridad');
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('responde con las cabeceras de helmet', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    // Fastify y NestJS no deben anunciar qué son.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('permite el origen configurado y habilita las credenciales para la cookie', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('no autoriza un origen que no está en CORS_ORIGINS', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://sitio-ajeno.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('corta al pasarse del límite y responde en problem+json', async () => {
    const token = await signTestToken(app, { userId: farm.userId, farmId: farm.farmId });

    let rechazo: request.Response | null = null;
    for (let intento = 0; intento < 8 && rechazo === null; intento += 1) {
      const response = await request(app.getHttpServer()).get('/api/v1/me').set(bearer(token));
      if (response.status === 429) rechazo = response;
    }

    expect(rechazo).not.toBeNull();
    expect(rechazo?.body).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      detail: 'Demasiadas solicitudes. Espera un momento.',
    });
    expect(rechazo?.headers['content-type']).toContain('application/problem+json');
  });
});
