import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7, type AnimalDetail, type AnimalDetailWithWarnings } from '@hato/shared';
import request from 'supertest';

import { TransactionsService } from '../src/common/idempotency/transactions.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import {
  cleanDatabase,
  createAnimal,
  createFarm,
  createMember,
  type TestFarm,
} from './helpers/fixtures.js';

/**
 * Escrituras listas para trabajar sin conexión (ADR-012), en lo que existía antes de M5:
 *
 * - §1 `id` del cliente en las creaciones: mismo contenido → 200; otro, u otra finca →
 *   `CLIENT_ID_CONFLICT`;
 * - §2 `Idempotency-Key` en las acciones: la misma clave no repite la acción; con otra petición,
 *   `IDEMPOTENCY_KEY_REUSED`; el candado es por (finca, clave), no por finca; `/auth` no la usa;
 * - §4 archivar lo archivado responde 200 con el estado actual;
 * - §5 `updated_at` lo mantiene el trigger, también en un `UPDATE` por SQL directo;
 * - quitar una etiqueta ya no borra la fila (`animal_tags.removed_at`).
 */
describe('Escrituras sin conexión (ADR-012)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let otherAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());
  const key = () => ({ 'Idempotency-Key': uuidv7() });

  const newAnimal = (overrides: Record<string, unknown> = {}) => ({
    id: uuidv7(),
    code: '26-001',
    sex: 'FEMALE',
    breedId: esperanza.breedId,
    birthDate: '2026-03-01',
    origin: 'BORN_ON_FARM',
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    esperanza = await createFarm(prisma, 'La Esperanza');
    palmar = await createFarm(prisma, 'El Palmar');
    admin = bearer(
      await signTestToken(app, { userId: esperanza.userId, farmId: esperanza.farmId }),
    );
    otherAdmin = bearer(await signTestToken(app, { userId: palmar.userId, farmId: palmar.farmId }));
    const { userId } = await createMember(prisma, esperanza, ROLE.OPERATOR);
    operator = bearer(await signTestToken(app, { userId, farmId: esperanza.farmId }));
  });

  // -------------------------------------------------------------------------------------------
  describe('§5 updated_at con el trigger set_updated_at()', () => {
    it('un UPDATE por SQL directo cambia updated_at', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '10' });
      await prisma.$executeRaw`
        UPDATE animals SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ${animalId}::uuid`;
      // El propio UPDATE de arriba también pasó por el trigger: no se puede fijar a mano.
      const [forced] = await prisma.$queryRaw<{ updated_at: Date }[]>`
        SELECT updated_at FROM animals WHERE id = ${animalId}::uuid`;
      expect(forced?.updated_at.getUTCFullYear()).not.toBe(2020);

      const before = forced?.updated_at.getTime() ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 20));
      await prisma.$executeRaw`UPDATE animals SET notes = 'SQL directo' WHERE id = ${animalId}::uuid`;
      const [after] = await prisma.$queryRaw<{ updated_at: Date }[]>`
        SELECT updated_at FROM animals WHERE id = ${animalId}::uuid`;
      expect(after?.updated_at.getTime()).toBeGreaterThan(before);
    });

    it('las tablas que se sincronizarán tienen el trigger y el índice (farm_id, updated_at)', async () => {
      const synced = [
        'animal_tags',
        'animals',
        'breeds',
        'expense_allocations',
        'expenses',
        'farms',
        'identifiers',
        'lot_movements',
        'lots',
        'pregnancies',
        'sales',
        'tags',
        'treatment_records',
        'vaccination_cycle_vaccines',
        'vaccination_cycles',
        'vaccination_records',
        'vaccines',
        'valuations',
        'weight_records',
        'work_sessions',
      ];
      const triggers = await prisma.$queryRaw<{ table: string }[]>`
        SELECT c.relname AS table FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = c.relname || '_set_updated_at' ORDER BY c.relname`;
      expect(triggers.map((row) => row.table)).toEqual(synced);

      const indexes = await prisma.$queryRaw<{ table: string }[]>`
        SELECT tablename AS table FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = tablename || '_farm_id_updated_at_idx'
        ORDER BY tablename`;
      expect(indexes.map((row) => row.table)).toEqual(synced.filter((table) => table !== 'farms'));
    });

    it('un UPDATE de un identificador y de un catálogo también la cambia', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '11' });
      const identifier = await prisma.identifier.create({
        data: {
          id: uuidv7(),
          farmId: esperanza.farmId,
          animalId,
          type: 'VISUAL_TAG',
          value: '11',
          assignedAt: new Date('2026-09-01T00:00:00Z'),
          updatedAt: new Date('2026-09-01T12:00:00Z'),
        },
      });
      await prisma.$executeRaw`
        UPDATE identifiers SET retired_at = '2026-09-20', retire_reason = 'LOST'
        WHERE id = ${identifier.id}::uuid`;
      await prisma.$executeRaw`UPDATE breeds SET is_active = false WHERE id = ${esperanza.breedId}::uuid`;
      const updated = await prisma.identifier.findUniqueOrThrow({ where: { id: identifier.id } });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(identifier.updatedAt.getTime());
      const breed = await prisma.breed.findUniqueOrThrow({ where: { id: esperanza.breedId } });
      expect(Date.now() - breed.updatedAt.getTime()).toBeLessThan(60_000);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('§1 id del cliente en las creaciones', () => {
    it('animal: mismo contenido → 200 sin duplicar; otro contenido → CLIENT_ID_CONFLICT', async () => {
      const body = newAnimal({ identifiers: [{ type: 'VISUAL_TAG', value: ' 26-001 ' }] });
      const first = await http().post('/api/v1/animals').set(operator).send(body).expect(201);
      const again = await http().post('/api/v1/animals').set(operator).send(body).expect(200);
      expect((again.body as AnimalDetail).id).toBe((first.body as AnimalDetail).id);
      expect(await prisma.animal.count({ where: { farmId: esperanza.farmId } })).toBe(1);
      expect(await prisma.identifier.count()).toBe(1);

      const conflict = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...body, name: 'Otra' })
        .expect(409);
      expect(conflict.body.code).toBe('CLIENT_ID_CONFLICT');
      expect(await prisma.animal.count()).toBe(1);
    });

    it('animal: el mismo id en otra finca → CLIENT_ID_CONFLICT, sin revelar nada', async () => {
      const body = newAnimal();
      await http().post('/api/v1/animals').set(operator).send(body).expect(201);
      const response = await http()
        .post('/api/v1/animals')
        .set(otherAdmin)
        .send({ ...body, breedId: palmar.breedId })
        .expect(409);
      expect(response.body.code).toBe('CLIENT_ID_CONFLICT');
      expect(response.body).not.toHaveProperty('context');
    });

    it('animal: el id debe ser UUIDv7', async () => {
      const response = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send(newAnimal({ id: '0b6f3d8e-1c2a-4b7e-9d10-2f3a4b5c6d7e' }))
        .expect(422);
      expect(response.body.errors).toHaveProperty('id');
    });

    it('identificador: mismo contenido → 200; otro valor → CLIENT_ID_CONFLICT', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '12' });
      const body = { id: uuidv7(), type: 'VISUAL_TAG', value: '12', assignedAt: '2026-09-01' };
      await http()
        .post(`/api/v1/animals/${animalId}/identifiers`)
        .set(operator)
        .send(body)
        .expect(201);
      await http()
        .post(`/api/v1/animals/${animalId}/identifiers`)
        .set(operator)
        .send(body)
        .expect(200);
      const conflict = await http()
        .post(`/api/v1/animals/${animalId}/identifiers`)
        .set(operator)
        .send({ ...body, value: '13' })
        .expect(409);
      expect(conflict.body.code).toBe('CLIENT_ID_CONFLICT');
      expect(await prisma.identifier.count()).toBe(1);
    });

    it.each([
      ['lots', { name: 'Paridas', description: 'Vacas con cría' }, { name: 'Horras' }],
      ['tags', { label: 'Descarte' }, { label: 'Engorde' }],
      ['breeds', { name: 'Gyr', group: 'INDICUS' }, { name: 'Gyr', group: 'CROSS' }],
      [
        'vaccines',
        { name: 'Triple', disease: 'Clostridiales', scheduleType: 'NONE' },
        { name: 'Triple', disease: 'Carbón', scheduleType: 'NONE' },
      ],
    ])(
      'catálogo %s: mismo contenido → 200; otro → CLIENT_ID_CONFLICT',
      async (path, body, other) => {
        const id = uuidv7();
        await http()
          .post(`/api/v1/${path}`)
          .set(admin)
          .send({ id, ...body })
          .expect(201);
        const again = await http()
          .post(`/api/v1/${path}`)
          .set(admin)
          .send({ id, ...body })
          .expect(200);
        expect(again.body.id).toBe(id);
        const conflict = await http()
          .post(`/api/v1/${path}`)
          .set(admin)
          .send({ id, ...other })
          .expect(409);
        expect(conflict.body.code).toBe('CLIENT_ID_CONFLICT');
        await http()
          .post(`/api/v1/${path}`)
          .set(otherAdmin)
          .send({ id, ...body })
          .expect(409);
      },
    );

    it('ciclo de vacunación: mismas vacunas en otro orden → 200', async () => {
      const vaccines = await Promise.all(
        ['Aftosa', 'Rabia'].map(async (name) => {
          const id = uuidv7();
          await prisma.vaccine.create({
            data: {
              id,
              farmId: esperanza.farmId,
              name,
              disease: name,
              scheduleType: 'OFFICIAL_CYCLE',
            },
          });
          return id;
        }),
      );
      const body = {
        id: uuidv7(),
        name: '2026-2',
        startsOn: '2026-11-01',
        endsOn: '2026-12-15',
        vaccineIds: vaccines,
      };
      await http().post('/api/v1/vaccination-cycles').set(admin).send(body).expect(201);
      const again = await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({ ...body, vaccineIds: [...vaccines].reverse() })
        .expect(200);
      expect(again.body.warnings).toEqual([]);
      await http()
        .post('/api/v1/vaccination-cycles')
        .set(admin)
        .send({ ...body, endsOn: '2026-12-16' })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('§2 Idempotency-Key en las acciones', () => {
    const archive = (animalId: string, headers: Record<string, string>, reason = 'Duplicado') =>
      http().post(`/api/v1/animals/${animalId}/archive`).set(admin).set(headers).send({ reason });

    it('la misma clave devuelve la respuesta guardada sin repetir la acción', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '20' });
      const headers = key();
      const first = await archive(animalId, headers).expect(201);
      const again = await archive(animalId, headers).expect(201);
      expect(again.body).toEqual(first.body);
      expect(
        await prisma.auditLog.count({ where: { entityId: animalId, action: 'ARCHIVE' } }),
      ).toBe(1);
      expect(await prisma.idempotencyKey.count()).toBe(1);
    });

    it('una salida repetida con la misma clave no responde ANIMAL_EXITED', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '21' });
      const headers = key();
      const body = { type: 'DEATH', date: '2026-09-20' };
      await http()
        .post(`/api/v1/animals/${animalId}/exit`)
        .set(admin)
        .set(headers)
        .send(body)
        .expect(201);
      const again = await http()
        .post(`/api/v1/animals/${animalId}/exit`)
        .set(admin)
        .set(headers)
        .send(body)
        .expect(201);
      expect((again.body as AnimalDetailWithWarnings).exit?.type).toBe('DEATH');
      // Sin la clave, repetir sí es un error: el animal ya salió.
      await http().post(`/api/v1/animals/${animalId}/exit`).set(admin).send(body).expect(409);
    });

    it('la misma clave con otra petición → IDEMPOTENCY_KEY_REUSED (422)', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '22' });
      const headers = key();
      await archive(animalId, headers).expect(201);
      const reused = await archive(animalId, headers, 'Otro motivo').expect(422);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherRoute = await http()
        .post('/api/v1/animals/bulk/lot')
        .set(admin)
        .set(headers)
        .send({ animalIds: [animalId], lotId: uuidv7(), date: '2026-09-25' })
        .expect(422);
      expect(otherRoute.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('una clave que no es UUID → VALIDATION_FAILED', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '23' });
      const response = await archive(animalId, { 'Idempotency-Key': 'uno' }).expect(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('si la acción falla no se guarda la clave y el reintento vuelve a intentarlo', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '24' });
      const headers = key();
      await http()
        .post(`/api/v1/animals/${animalId}/exit`)
        .set(admin)
        .set(headers)
        .send({ type: 'DEATH', date: '2030-01-01' })
        .expect(422);
      expect(await prisma.idempotencyKey.count()).toBe(0);
    });

    it('dos reintentos simultáneos con la misma clave hacen la acción una sola vez', async () => {
      const animals = await Promise.all(
        ['30', '31', '32'].map((code) => createAnimal(prisma, esperanza, { code })),
      );
      const headers = key();
      const body = { animalIds: animals, add: [] as string[], forSale: true };
      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          http().post('/api/v1/animals/bulk/tags').set(admin).set(headers).send(body),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
      expect(await prisma.auditLog.count({ where: { entity: 'Animal', action: 'UPDATE' } })).toBe(
        3,
      );
    });

    it('el candado es por (finca, clave): otra clave de la misma finca no espera', async () => {
      const [a, b] = await Promise.all(
        ['40', '41'].map((code) => createAnimal(prisma, esperanza, { code })),
      );
      const heldKey = uuidv7();
      let otherFinished = false;
      let sameFinished = false;
      let sameRequest: Promise<unknown> | undefined;

      await prisma.$transaction(
        async (tx) => {
          // Retiene el mismo candado que tomaría una acción con `heldKey` en esta finca.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtextextended('idempotency:' || ${esperanza.farmId}::text || ':' || ${heldKey}::text, 0))`;
          sameRequest = archive(a as string, { 'Idempotency-Key': heldKey }).then(() => {
            sameFinished = true;
          });
          await archive(b as string, key()).expect(201);
          otherFinished = true;
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(sameFinished).toBe(false);
        },
        { timeout: 20_000 },
      );
      await sameRequest;
      expect(otherFinished).toBe(true);
      expect(sameFinished).toBe(true);
    });

    it('la misma clave en otra finca es otra clave', async () => {
      const mine = await createAnimal(prisma, esperanza, { code: '50' });
      const theirs = await createAnimal(prisma, palmar, { code: '50' });
      const headers = key();
      await archive(mine, headers).expect(201);
      await http()
        .post(`/api/v1/animals/${theirs}/archive`)
        .set(otherAdmin)
        .set(headers)
        .send({ reason: 'Duplicado' })
        .expect(201);
      expect(await prisma.idempotencyKey.count()).toBe(2);
    });

    it('una clave de más de 7 días no cuenta y la purga la borra', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '60' });
      const headers = key();
      await prisma.idempotencyKey.create({
        data: {
          id: uuidv7(),
          farmId: esperanza.farmId,
          key: headers['Idempotency-Key'],
          method: 'POST',
          path: '/otra',
          requestHash: 'x',
          responseStatus: 201,
          responseBody: {},
          createdAt: new Date('2026-09-10T12:00:00Z'),
        },
      });
      // «Hoy» es el 25/09/2026: la clave tiene 15 días y ya no aplica.
      await archive(animalId, headers).expect(201);

      await prisma.idempotencyKey.create({
        data: {
          id: uuidv7(),
          farmId: esperanza.farmId,
          key: uuidv7(),
          method: 'POST',
          path: '/vieja',
          requestHash: 'x',
          responseStatus: 201,
          responseBody: {},
          createdAt: new Date('2026-09-01T12:00:00Z'),
        },
      });
      expect(await app.get(TransactionsService).purgeExpired()).toBe(1);
      expect(await prisma.idempotencyKey.count()).toBe(1);
    });

    it('/auth no acepta la clave: iniciar sesión con el encabezado no guarda nada', async () => {
      const { username } = await createMember(prisma, esperanza, ROLE.OPERATOR, {
        password: 'clave-de-prueba-1',
      });
      await http()
        .post('/api/v1/auth/login')
        .set(key())
        .send({ login: username, password: 'clave-de-prueba-1' })
        .expect(201);
      expect(await prisma.idempotencyKey.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('§4 archivar lo archivado', () => {
    it('responde 200 con la ficha actual y no deja otra auditoría', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '70' });
      await http()
        .post(`/api/v1/animals/${animalId}/archive`)
        .set(admin)
        .send({ reason: 'Duplicado' })
        .expect(201);
      const again = await http()
        .post(`/api/v1/animals/${animalId}/archive`)
        .set(admin)
        .send({ reason: 'Duplicado' })
        .expect(200);
      expect((again.body as AnimalDetail).archive?.reason).toBe('Duplicado');
      expect(
        await prisma.auditLog.count({ where: { entityId: animalId, action: 'ARCHIVE' } }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('etiquetas del animal sin borrado físico', () => {
    it('quitar marca removed_at; volver a ponerla crea otra fila; la ficha solo ve la vigente', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '80' });
      const tagId = uuidv7();
      await prisma.tag.create({
        data: { id: tagId, farmId: esperanza.farmId, key: 'DESCARTE', label: 'Descarte' },
      });
      const bulk = (body: Record<string, unknown>) =>
        http()
          .post('/api/v1/animals/bulk/tags')
          .set(operator)
          .send({ animalIds: [animalId], ...body })
          .expect(201);

      await bulk({ add: [tagId] });
      await bulk({ add: [tagId] });
      await bulk({ remove: [tagId] });
      const removed = await prisma.animalTag.findMany({ where: { animalId } });
      expect(removed).toHaveLength(1);
      expect(removed[0]?.removedAt).not.toBeNull();
      expect(removed[0]?.removedById).not.toBeNull();

      const detail = (await http().get(`/api/v1/animals/${animalId}`).set(operator).expect(200))
        .body as AnimalDetail;
      expect(detail.manualTags).toEqual([]);
      const list = await http().get('/api/v1/animals?tags=DESCARTE').set(operator).expect(200);
      expect(list.body.total).toBe(0);

      await bulk({ add: [tagId] });
      expect(await prisma.animalTag.count({ where: { animalId } })).toBe(2);
      expect(await prisma.animalTag.count({ where: { animalId, removedAt: null } })).toBe(1);
    });

    it('la base no admite dos filas vigentes de la misma etiqueta', async () => {
      const animalId = await createAnimal(prisma, esperanza, { code: '81' });
      const tagId = uuidv7();
      await prisma.tag.create({
        data: { id: tagId, farmId: esperanza.farmId, key: 'X', label: 'X' },
      });
      const row = () => ({
        id: uuidv7(),
        farmId: esperanza.farmId,
        animalId,
        tagId,
        createdById: esperanza.userId,
      });
      await prisma.animalTag.create({ data: row() });
      await expect(prisma.animalTag.create({ data: row() })).rejects.toThrow();
    });
  });
});
