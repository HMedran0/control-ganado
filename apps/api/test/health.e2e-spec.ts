import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { createTestApp } from './helpers/app.js';

describe('GET /api/v1/health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con el estado de la API y de la base de datos', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      database: 'ok',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      clockFixed: false,
    });
  });

  it('es público: no necesita cabeceras de autenticación', async () => {
    // Sin x-dev-farm-id: si el guard no lo eximiera, respondería 403.
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('responde 503 en problem+json si la base de datos no responde', async () => {
    const prisma = app.get(PrismaService);
    const ping = vi.spyOn(prisma, 'ping').mockRejectedValue(new Error('conexión caída'));

    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      status: 503,
      detail: 'La base de datos no responde.',
    });
    // El mensaje interno no viaja al cliente.
    expect(JSON.stringify(response.body)).not.toContain('conexión caída');

    ping.mockRestore();
  });

  it('un endpoint que no existe responde 404 en problem+json y en español', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/no-existe').expect(404);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      detail: 'El registro no existe o no pertenece a esta finca.',
    });
  });
});
