import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE } from '@hato/shared';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, createMember, type TestFarm } from './helpers/fixtures.js';
import { ProbeController } from './helpers/probe.controller.js';

/**
 * El contrato de errores de la API (04-arquitectura.md §4, 05-api.md): `application/problem+json`
 * con `code` estable y `detail` en español listo para mostrar.
 */
describe('Filtro de errores problem+json', () => {
  let app: NestFastifyApplication;
  let farm: TestFarm;
  let headers: Record<string, string>;

  /** Cabeceras de un usuario de la finca con el rol indicado. */
  const as = async (role: Parameters<typeof createMember>[2]): Promise<Record<string, string>> => {
    const prisma = app.get(PrismaService);
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'Finca del contrato de errores');
    headers = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
  });

  afterAll(async () => {
    await cleanDatabase(app.get(PrismaService));
    await app.close();
  });

  it('traduce un DomainError con su código, estado y mensaje interpolado', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/domain-error')
      .set(headers)
      .expect(409);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      type: 'https://hato.app/problems/animal-code-taken',
      title: 'Conflicto',
      status: 409,
      code: 'ANIMAL_CODE_TAKEN',
      detail: 'Ya existe un animal con el código 26-045.',
      instance: '/api/v1/probe/domain-error',
    });
  });

  it('incluye los errores por campo de una validación', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/validation-error')
      .set(headers)
      .expect(422);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      detail: 'Revisa los campos marcados.',
      errors: { birthDate: ['La fecha no puede ser posterior a hoy.'] },
    });
  });

  it('convierte un error no controlado en 500 sin filtrar el detalle interno', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/unexpected-error')
      .set(headers)
      .expect(500);

    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      detail: 'Ocurrió un error inesperado. Ya quedó registrado.',
    });
    expect(JSON.stringify(response.body)).not.toContain('detalle interno');
  });

  it('lleva un requestId para cruzar con los logs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/domain-error')
      .set(headers)
      .expect(409);

    expect(typeof response.body.requestId).toBe('string');
    expect(response.body.requestId).not.toBe('');
  });

  it('valida la query con un esquema zod de shared y responde 422 por campo', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/settings')
      .query({ raw: JSON.stringify({ weaningAgeMonths: 0 }) })
      .set(headers)
      .expect(422);

    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  describe('RolesGuard', () => {
    it('deja pasar al rol autorizado', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/probe/admin-only')
        .set(await as(ROLE.ADMIN))
        .expect(200);
    });

    it('responde 403 FORBIDDEN_ROLE al rol no autorizado', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/probe/admin-only')
        .set(await as(ROLE.OPERATOR))
        .expect(403);

      expect(response.body).toMatchObject({
        code: 'FORBIDDEN_ROLE',
        detail: 'Tu rol no permite esta acción.',
      });
    });

    it('un ADMIN también recibe 403 en un endpoint exclusivo de VET', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/probe/vet-only')
        .set(await as(ROLE.ADMIN))
        .expect(403);
    });

    it('sin token responde 401, no 403', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/probe/admin-only')
        .expect(401);

      expect(response.body.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });
});
