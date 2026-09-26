import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@hato/shared';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { createTestApp, devAuthHeaders } from './helpers/app.js';
import { cleanDatabase, createAnimal, createFarm, type TestFarm } from './helpers/fixtures.js';
import { ProbeController } from './helpers/probe.controller.js';

/**
 * Aislamiento por finca (CLAUDE.md, regla 1; RN-21).
 *
 * 04-arquitectura.md §4 lo pide explícitamente: «una prueba de integración verifica que ningún
 * endpoint devuelve datos de otra finca». Con dos fincas reales en la base de datos, cada una
 * con animales propios.
 */
describe('FarmScope: aislamiento por finca', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);

    await cleanDatabase(prisma);
    esperanza = await createFarm(prisma, 'La Esperanza');
    palmar = await createFarm(prisma, 'El Palmar');

    await createAnimal(prisma, esperanza, { code: 'E-001' });
    await createAnimal(prisma, esperanza, { code: 'E-002' });
    await createAnimal(prisma, esperanza, { code: 'E-003' });
    await createAnimal(prisma, palmar, { code: 'P-001' });
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('cada finca solo ve sus propios animales', async () => {
    const primera = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(devAuthHeaders(esperanza.farmId))
      .expect(200);
    expect(primera.body.codes).toEqual(['E-001', 'E-002', 'E-003']);

    const segunda = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(devAuthHeaders(palmar.farmId))
      .expect(200);
    expect(segunda.body.codes).toEqual(['P-001']);
  });

  it('los conteos no se mezclan', async () => {
    const primera = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/count')
      .set(devAuthHeaders(esperanza.farmId))
      .expect(200);
    const segunda = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/count')
      .set(devAuthHeaders(palmar.farmId))
      .expect(200);

    expect(primera.body.count).toBe(3);
    expect(segunda.body.count).toBe(1);
    // Hay 4 animales en la base: ninguna finca ve el total.
    expect(await prisma.animal.count()).toBe(4);
  });

  it('una finca que no existe no ve nada, no los datos de otra', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(devAuthHeaders(uuidv7()))
      .expect(200);

    expect(response.body.codes).toEqual([]);
  });

  it('el farmId sale de la cabecera de autenticación, nunca del cuerpo ni de la query', async () => {
    // Se pide con el ámbito de El Palmar pero pasando el farmId de La Esperanza en la query:
    // el filtro debe seguir siendo el del ámbito.
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .query({ farmId: esperanza.farmId })
      .set(devAuthHeaders(palmar.farmId))
      .expect(200);

    expect(response.body.codes).toEqual(['P-001']);
  });

  it('sin cabecera de finca responde 403 y no devuelve datos', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN_ROLE');
    expect(response.body.codes).toBeUndefined();
  });

  it('con una finca que no es un UUID responde 403', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set({ 'x-dev-farm-id': 'la-esperanza' })
      .expect(403);
  });

  it('el ámbito expuesto es el de la cabecera', async () => {
    const userId = uuidv7();
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/scope')
      .set(devAuthHeaders(esperanza.farmId, 'VET', userId))
      .expect(200);

    expect(response.body).toEqual({ farmId: esperanza.farmId, userId, role: 'VET' });
  });
});
