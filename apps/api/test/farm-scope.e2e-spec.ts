import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7 } from '@hato/shared';
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
  let deEsperanza: Record<string, string>;
  let dePalmar: Record<string, string>;

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

  /** Token de un usuario real de cada finca; el ámbito sale de su membresía. */
  beforeAll(async () => {
    deEsperanza = bearer(
      await signTestToken(app, { userId: esperanza.userId, farmId: esperanza.farmId }),
    );
    dePalmar = bearer(await signTestToken(app, { userId: palmar.userId, farmId: palmar.farmId }));
  });

  it('cada finca solo ve sus propios animales', async () => {
    const primera = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(deEsperanza)
      .expect(200);
    expect(primera.body.codes).toEqual(['E-001', 'E-002', 'E-003']);

    const segunda = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(dePalmar)
      .expect(200);
    expect(segunda.body.codes).toEqual(['P-001']);
  });

  it('los conteos no se mezclan', async () => {
    const primera = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/count')
      .set(deEsperanza)
      .expect(200);
    const segunda = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/count')
      .set(dePalmar)
      .expect(200);

    expect(primera.body.count).toBe(3);
    expect(segunda.body.count).toBe(1);
    // Hay 4 animales en la base: ninguna finca ve el total.
    expect(await prisma.animal.count()).toBe(4);
  });

  it('un token con una finca en la que el usuario no tiene membresía no entra', async () => {
    const token = await signTestToken(app, { userId: esperanza.userId, farmId: uuidv7() });
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(bearer(token))
      .expect(401);

    expect(response.body.code).toBe('AUTH_TOKEN_EXPIRED');
    expect(response.body.codes).toBeUndefined();
  });

  it('un usuario no puede pedir los datos de otra finca firmando su id', async () => {
    // El usuario de El Palmar pide el ámbito de La Esperanza: no tiene membresía ahí.
    const token = await signTestToken(app, {
      userId: palmar.userId,
      farmId: esperanza.farmId,
    });
    await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(bearer(token))
      .expect(401);
  });

  it('el farmId sale de la cabecera de autenticación, nunca del cuerpo ni de la query', async () => {
    // Se pide con el ámbito de El Palmar pero pasando el farmId de La Esperanza en la query:
    // el filtro debe seguir siendo el del ámbito.
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .query({ farmId: esperanza.farmId })
      .set(dePalmar)
      .expect(200);

    expect(response.body.codes).toEqual(['P-001']);
  });

  it('sin token responde 401 y no devuelve datos', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .expect(401);

    expect(response.body.code).toBe('AUTH_TOKEN_EXPIRED');
    expect(response.body.codes).toBeUndefined();
  });

  it('con un token ilegible responde 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/probe/animals/codes')
      .set(bearer('esto.no.es-un-token'))
      .expect(401);
  });

  it('el ámbito expuesto sale de la membresía, no de lo que diga el token', async () => {
    const { userId } = await createMember(prisma, esperanza, ROLE.VET);
    // El token se firma diciendo ADMIN, pero la membresía es de VET: manda la base.
    const token = await signTestToken(app, {
      userId,
      farmId: esperanza.farmId,
      role: ROLE.ADMIN,
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/scope')
      .set(bearer(token))
      .expect(200);

    expect(response.body).toEqual({ farmId: esperanza.farmId, userId, role: 'VET' });
  });
});
