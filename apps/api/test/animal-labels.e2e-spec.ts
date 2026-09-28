import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ROLE,
  uuidv7,
  type AnimalDetail,
  type AnimalLabels,
  type SearchResult,
} from '@hato/shared';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, createMember, type TestFarm } from './helpers/fixtures.js';

/**
 * QR del sistema y hoja de etiquetas (IDN-03): el QR solo lleva `PUBLIC_WEB_URL/a/<id>`, la hoja
 * es solo de ADMIN y el contenido del QR abre la ficha desde el buscador (ANI-05).
 */

const WEB = (process.env.PUBLIC_WEB_URL ?? '').replace(/\/+$/, '');

describe('QR y etiquetas (IDN-03)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let otherFarm: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let cow: string;
  let bull: string;
  let foreign: string;

  const http = () => request(app.getHttpServer());
  const create = async (
    headers: Record<string, string>,
    target: TestFarm,
    body: Record<string, unknown>,
  ): Promise<string> =>
    (
      await http()
        .post('/api/v1/animals')
        .set(headers)
        .send({
          sex: 'FEMALE',
          breedId: target.breedId,
          birthDate: '2022-03-15',
          origin: 'BORN_ON_FARM',
          ...body,
        })
        .expect(201)
    ).body.id as string;

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
    await cleanDatabase(prisma);
    farm = await createFarm(prisma, 'La Esperanza');
    otherFarm = await createFarm(prisma, 'El Retiro');
    admin = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
    const op = await createMember(prisma, farm, ROLE.OPERATOR);
    const doctor = await createMember(prisma, farm, ROLE.VET);
    operator = bearer(await signTestToken(app, { userId: op.userId, farmId: farm.farmId }));
    vet = bearer(await signTestToken(app, { userId: doctor.userId, farmId: farm.farmId }));
    otherAdmin = bearer(
      await signTestToken(app, { userId: otherFarm.userId, farmId: otherFarm.farmId }),
    );
    cow = await create(admin, farm, {
      code: '087',
      name: 'Canela',
      identifiers: [
        { type: 'VISUAL_TAG', value: '087' },
        { type: 'DIN', value: 'CO-0100000234567' },
        { type: 'RFID', value: '170000123456789' },
      ],
    });
    bull = await create(admin, farm, { code: '012', sex: 'MALE' });
    foreign = await create(otherAdmin, otherFarm, { code: '999' });
  });

  it('la ficha trae la URL del QR, sin datos del animal, para todos los roles', async () => {
    for (const headers of [admin, operator, vet]) {
      const detail = (await http().get(`/api/v1/animals/${cow}`).set(headers).expect(200))
        .body as AnimalDetail;
      expect(detail.qrUrl).toBe(`${WEB}/a/${cow}`);
    }
  });

  it('hoja de una selección, en su orden y solo con lo que va en la etiqueta', async () => {
    const body = (
      await http().get(`/api/v1/animals/labels?ids=${bull},${cow}`).set(admin).expect(200)
    ).body as AnimalLabels;
    expect(body).toEqual({
      truncated: false,
      items: [
        {
          id: bull,
          code: '012',
          name: null,
          sex: 'MALE',
          visualTag: null,
          din: null,
          rfid: null,
          qrUrl: `${WEB}/a/${bull}`,
        },
        {
          id: cow,
          code: '087',
          name: 'Canela',
          sex: 'FEMALE',
          visualTag: '087',
          din: 'CO0100000234567',
          rfid: '170000123456789',
          qrUrl: `${WEB}/a/${cow}`,
        },
      ],
    });
  });

  it('sin selección, lo del listado con sus filtros', async () => {
    const body = (await http().get('/api/v1/animals/labels?sex=MALE').set(admin).expect(200))
      .body as AnimalLabels;
    expect(body.items.map((item) => item.code)).toEqual(['012']);
  });

  it('un animal de otra finca no sale en la hoja', async () => {
    const body = (
      await http().get(`/api/v1/animals/labels?ids=${foreign},${cow}`).set(admin).expect(200)
    ).body as AnimalLabels;
    expect(body.items.map((item) => item.id)).toEqual([cow]);
  });

  it('OPERATOR y VET no imprimen etiquetas; más de 200 ids, 422', async () => {
    for (const headers of [operator, vet]) {
      await http().get('/api/v1/animals/labels').set(headers).expect(403);
    }
    const many = Array.from({ length: 201 }, () => uuidv7()).join(',');
    await http().get(`/api/v1/animals/labels?ids=${many}`).set(admin).expect(422);
  });

  it('el contenido del QR en el buscador abre la ficha; el de otra finca, no', async () => {
    const found = (
      await http()
        .get('/api/v1/animals/search')
        .query({ q: `${WEB}/a/${cow}` })
        .set(operator)
        .expect(200)
    ).body as SearchResult;
    expect(found.exactMatch).toMatchObject({ animalId: cow, via: { kind: 'QR', value: cow } });

    const other = (
      await http()
        .get('/api/v1/animals/search')
        .query({ q: `${WEB}/a/${foreign}` })
        .set(operator)
        .expect(200)
    ).body as SearchResult;
    expect(other.exactMatch).toBeNull();
  });
});
