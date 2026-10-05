import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEFAULT_FARM_SETTINGS,
  ROLE,
  toIsoDate,
  uuidv7,
  type AnimalDetail,
  type AnimalDetailWithWarnings,
  type AuditPage,
  type Role,
  type SearchResult,
  type Timeline,
} from '@hato/shared';
import request from 'supertest';

import { toPrismaDate } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, createMember, type TestFarm } from './helpers/fixtures.js';

/**
 * Salida, reversión, archivo y restauración (ANI-03, ANI-04), numeración reutilizable (ANI-10,
 * ANI-11, IDN-06, RN-30 a RN-33) y consulta de la auditoría (AUD-01 CA2), contra PostgreSQL real.
 *
 * «Retiro» reutiliza números con el menor libre; «Esperanza» no reutiliza (valores por defecto).
 * Cada endpoint se prueba con ADMIN, con un rol no autorizado y con un ADMIN de otra finca.
 * «Hoy» es el 25/09/2026.
 */
describe('Salida, archivo y numeración reutilizable', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let retiro: TestFarm;
  let esperanza: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let esperanzaAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  const create = async (
    headers: Record<string, string>,
    farm: TestFarm,
    body: {
      code: string;
      identifiers?: { type: string; value: string; confirmReuse?: boolean }[];
    },
  ): Promise<AnimalDetailWithWarnings> =>
    (
      await http()
        .post('/api/v1/animals')
        .set(headers)
        .send({
          sex: 'FEMALE',
          breedId: farm.breedId,
          birthDate: '2024-05-10',
          origin: 'BORN_ON_FARM',
          ...body,
        })
        .expect(201)
    ).body as AnimalDetailWithWarnings;

  const sell = (headers: Record<string, string>, id: string, extra: object = {}) =>
    http()
      .post(`/api/v1/animals/${id}/exit`)
      .set(headers)
      .send({
        type: 'SALE',
        date: '2026-09-20',
        sale: { amount: '3500000', buyer: 'Don Rafael' },
        ...extra,
      });

  const detail = async (headers: Record<string, string>, id: string): Promise<AnimalDetail> =>
    (await http().get(`/api/v1/animals/${id}`).set(headers).expect(200)).body as AnimalDetail;

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
    retiro = await createFarm(prisma, 'El Retiro');
    await prisma.farm.update({
      where: { id: retiro.farmId },
      data: {
        settings: { ...DEFAULT_FARM_SETTINGS, codeReuse: true, codeSuggestion: 'LOWEST_FREE' },
      },
    });
    esperanza = await createFarm(prisma, 'La Esperanza');
    admin = bearer(await signTestToken(app, { userId: retiro.userId, farmId: retiro.farmId }));
    esperanzaAdmin = bearer(
      await signTestToken(app, { userId: esperanza.userId, farmId: esperanza.farmId }),
    );
    operator = await as(retiro, ROLE.OPERATOR);
    vet = await as(retiro, ROLE.VET);
  });

  describe('POST /animals/:id/exit (ANI-04, IDN-06)', () => {
    it('ADMIN vende: crea la venta, libera la chapeta y deja DIN y RFID con el animal (RN-32)', async () => {
      const animal = await create(admin, retiro, {
        code: '5',
        identifiers: [
          { type: 'VISUAL_TAG', value: '5' },
          { type: 'DIN', value: 'CO-0001-2345' },
          { type: 'RFID', value: '170000000000005' },
        ],
      });

      const response = await sell(admin, animal.id).expect(201);
      const sold = response.body as AnimalDetailWithWarnings;
      expect(sold).toMatchObject({
        status: 'SOLD',
        exit: { type: 'SALE', date: '2026-09-20' },
      });
      const byType = Object.fromEntries(
        sold.identifiers.map((identifier) => [identifier.type, identifier]),
      );
      expect(byType.VISUAL_TAG).toMatchObject({ retiredAt: '2026-09-20', retireReason: 'EXITED' });
      expect(byType.DIN).toMatchObject({ retiredAt: null });
      expect(byType.RFID).toMatchObject({ retiredAt: null });

      const sale = await prisma.sale.findFirstOrThrow({ where: { animalId: animal.id } });
      expect(sale.amount.toFixed(2)).toBe('3500000.00');
      expect(sale.buyer).toBe('Don Rafael');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: animal.id, action: 'EXIT' },
      });
      expect(audit.diff).toMatchObject({
        after: { exitType: 'SALE', sale: true, releasedIdentifiers: ['VISUAL_TAG:5'] },
      });
    });

    it('sin numeración reutilizable, la chapeta sigue con el animal que salió', async () => {
      const animal = await create(esperanzaAdmin, esperanza, {
        code: '26-001',
        identifiers: [{ type: 'VISUAL_TAG', value: '26-001' }],
      });
      await http()
        .post(`/api/v1/animals/${animal.id}/exit`)
        .set(esperanzaAdmin)
        .send({ type: 'DEATH', date: '2026-09-20', reason: 'Rayo' })
        .expect(201);
      const identifier = await prisma.identifier.findFirstOrThrow({
        where: { animalId: animal.id },
      });
      expect(identifier.retiredAt).toBeNull();
    });

    it('venta sin precio: SALE_AMOUNT_REQUIRED con el campo marcado', async () => {
      const animal = await create(admin, retiro, { code: '6' });
      const response = await http()
        .post(`/api/v1/animals/${animal.id}/exit`)
        .set(admin)
        .send({ type: 'SALE', date: '2026-09-20' })
        .expect(422);
      expect(response.body).toMatchObject({
        code: 'SALE_AMOUNT_REQUIRED',
        errors: { 'sale.amount': ['Indica el precio de venta.'] },
      });
    });

    it('retiro vigente: WITHDRAWAL_ACTIVE y, confirmado, sale y queda en la auditoría (RN-22)', async () => {
      const animal = await create(admin, retiro, { code: '7' });
      await prisma.treatmentRecord.create({
        data: {
          id: uuidv7(),
          farmId: retiro.farmId,
          animalId: animal.id,
          startedOn: toPrismaDate(toIsoDate('2026-09-15')),
          reason: 'Neumonía',
          medication: 'Oxitetraciclina',
          durationDays: 1,
          withdrawalMeatDays: 12,
          withdrawalMilkDays: 3,
          withdrawalUntil: toPrismaDate(toIsoDate('2026-09-28')),
          createdById: retiro.userId,
        },
      });

      const blocked = await sell(admin, animal.id).expect(409);
      expect(blocked.body).toMatchObject({
        code: 'WITHDRAWAL_ACTIVE',
        detail: 'El animal está en retiro hasta 28/09/2026. Confirma para continuar.',
      });
      await sell(admin, animal.id, { confirmWithdrawal: true }).expect(201);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: animal.id, action: 'EXIT' },
      });
      expect(audit.diff).toMatchObject({ after: { withdrawalConfirmed: true } });
    });

    it('M6: un retiro solo de leche no exige confirmar la venta en pie (RN-22)', async () => {
      const animal = await create(admin, retiro, { code: '17' });
      await prisma.treatmentRecord.create({
        data: {
          id: uuidv7(),
          farmId: retiro.farmId,
          animalId: animal.id,
          startedOn: toPrismaDate(toIsoDate('2026-09-20')),
          reason: 'Mastitis',
          medication: 'Cefalexina intramamaria',
          durationDays: 2,
          withdrawalMeatDays: 0,
          withdrawalMilkDays: 10,
          withdrawalUntil: toPrismaDate(toIsoDate('2026-10-02')),
          createdById: retiro.userId,
        },
      });
      await sell(admin, animal.id).expect(201);
    });

    it('fecha futura, salida repetida y animal archivado', async () => {
      const animal = await create(admin, retiro, { code: '8' });
      await http()
        .post(`/api/v1/animals/${animal.id}/exit`)
        .set(admin)
        .send({ type: 'DEATH', date: '2026-09-26' })
        .expect(422);
      await sell(admin, animal.id).expect(201);
      expect((await sell(admin, animal.id).expect(409)).body.code).toBe('ANIMAL_EXITED');
    });

    it('OPERATOR y VET no pueden; un ADMIN de otra finca recibe 404', async () => {
      const animal = await create(admin, retiro, { code: '9' });
      for (const headers of [operator, vet]) {
        expect((await sell(headers, animal.id).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      }
      await sell(esperanzaAdmin, animal.id).expect(404);
    });
  });

  describe('Numeración reutilizable (ANI-10, ANI-11)', () => {
    it('un número vendido se le da a otro animal; cada uno conserva su historial (RN-33)', async () => {
      const old = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      await sell(admin, old.id).expect(201);
      // La chapeta liberada se reasigna sin confirmación (IDN-06 CA1).
      const fresh = await create(admin, retiro, {
        code: '05',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      expect(fresh.warnings).toEqual([]);

      expect((await detail(admin, fresh.id)).codeHistory).toEqual({
        previousHolder: { animalId: old.id, code: '5', status: 'SOLD', exitDate: '2026-09-20' },
        currentHolder: null,
      });
      expect((await detail(admin, old.id)).codeHistory).toEqual({
        previousHolder: null,
        currentHolder: { animalId: fresh.id, code: '05', status: 'ACTIVE', exitDate: null },
      });

      // La línea de tiempo nunca mezcla dos animales con el mismo número (ANI-11 CA4).
      for (const [animal, other] of [
        [old, fresh],
        [fresh, old],
      ] as const) {
        const timeline = (
          await http().get(`/api/v1/animals/${animal.id}/timeline`).set(admin).expect(200)
        ).body as Timeline;
        const keys = JSON.stringify(timeline.items);
        expect(keys).not.toContain(other.id);
        const identifierIds = timeline.items
          .filter((item) => item.kind === 'IDENTIFIER_ASSIGNED')
          .map((item) => (item.data as { identifierId: string }).identifierId);
        const own = await prisma.identifier.findMany({
          where: { animalId: animal.id },
          select: { id: true },
        });
        expect(identifierIds.sort()).toEqual(own.map((row) => row.id).sort());
      }
    });

    it('la búsqueda exacta devuelve el activo; si ninguno lo tiene, el que salió (ANI-11 CA1)', async () => {
      const old = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      await sell(admin, old.id).expect(201);

      const onlyExited = (
        await http().get('/api/v1/animals/search').query({ q: '005' }).set(admin).expect(200)
      ).body as SearchResult;
      expect(onlyExited.exactMatch?.animalId).toBe(old.id);
      expect(onlyExited.items[0]).toMatchObject({ id: old.id, status: 'SOLD' });

      const fresh = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      const both = (
        await http().get('/api/v1/animals/search').query({ q: '5' }).set(admin).expect(200)
      ).body as SearchResult;
      expect(both.exactMatch?.animalId).toBe(fresh.id);
      expect(both.items.map((item) => item.id)).toEqual([fresh.id]);
    });

    it('sin reutilización, el código de un animal que salió sigue ocupado, también normalizado', async () => {
      const animal = await create(esperanzaAdmin, esperanza, { code: '5' });
      await http()
        .post(`/api/v1/animals/${animal.id}/exit`)
        .set(esperanzaAdmin)
        .send({ type: 'DEATH', date: '2026-09-20' })
        .expect(201);
      for (const code of ['5', '05', ' 005 ']) {
        const response = await http()
          .post('/api/v1/animals')
          .set(esperanzaAdmin)
          .send({
            code,
            sex: 'MALE',
            breedId: esperanza.breedId,
            birthDate: '2025-01-01',
            origin: 'BORN_ON_FARM',
          })
          .expect(409);
        expect(response.body).toMatchObject({
          code: 'ANIMAL_CODE_TAKEN',
          context: { animalId: animal.id, animalCode: '5' },
        });
      }
    });

    it('con reutilización, dos activos no pueden compartir el número normalizado', async () => {
      await create(admin, retiro, { code: '12' });
      const response = await http()
        .post('/api/v1/animals')
        .set(admin)
        .send({
          code: '012',
          sex: 'MALE',
          breedId: retiro.breedId,
          birthDate: '2025-01-01',
          origin: 'BORN_ON_FARM',
        })
        .expect(409);
      expect(response.body.code).toBe('ANIMAL_CODE_TAKEN');
    });

    it('LOWEST_FREE busca donde se exige la unicidad: activos con reutilización, no archivados sin ella', async () => {
      for (const code of ['1', '2', '3', '4', '5', '6']) await create(admin, retiro, { code });
      const five = await prisma.animal.findFirstOrThrow({
        where: { farmId: retiro.farmId, code: '5' },
      });
      await sell(admin, five.id).expect(201);
      const nextRetiro = await http().get('/api/v1/animals/next-code').set(admin).expect(200);
      expect(nextRetiro.body).toEqual({ code: '5', codes: ['5'] });

      // La misma finca sin reutilización: el 5 vendido sigue ocupado; el siguiente libre es el 7.
      await prisma.farm.update({
        where: { id: retiro.farmId },
        data: {
          settings: { ...DEFAULT_FARM_SETTINGS, codeReuse: false, codeSuggestion: 'LOWEST_FREE' },
        },
      });
      const nextStrict = await http().get('/api/v1/animals/next-code').set(admin).expect(200);
      expect(nextStrict.body).toEqual({ code: '7', codes: ['7'] });

      // Un archivado no ocupa su número en ningún modo.
      const six = await prisma.animal.findFirstOrThrow({
        where: { farmId: retiro.farmId, code: '6' },
      });
      await http()
        .post(`/api/v1/animals/${six.id}/archive`)
        .set(admin)
        .send({ reason: 'Registro duplicado' })
        .expect(201);
      expect((await http().get('/api/v1/animals/next-code').set(admin).expect(200)).body).toEqual({
        code: '6',
        codes: ['6'],
      });
    });

    it('dos registros simultáneos del mismo código: uno 201 y los demás 409, nunca 500', async () => {
      for (const [headers, farm] of [
        [esperanzaAdmin, esperanza],
        [admin, retiro],
      ] as const) {
        const responses = await Promise.all(
          ['40', '040', '40', '0040'].map((code) =>
            http().post('/api/v1/animals').set(headers).send({
              code,
              sex: 'FEMALE',
              breedId: farm.breedId,
              birthDate: '2025-01-01',
              origin: 'BORN_ON_FARM',
            }),
          ),
        );
        const statuses = responses.map((response) => response.status).sort();
        expect(statuses).toEqual([201, 409, 409, 409]);
        for (const response of responses.filter((item) => item.status === 409)) {
          expect(response.body.code).toBe('ANIMAL_CODE_TAKEN');
        }
      }
    });

    it('desactivar la reutilización con números repetidos: CODE_REUSE_CONFLICT (ANI-10 CA3)', async () => {
      const old = await create(admin, retiro, { code: '5' });
      await sell(admin, old.id).expect(201);
      const fresh = await create(admin, retiro, { code: '5' });
      const farm = await prisma.farm.findUniqueOrThrow({ where: { id: retiro.farmId } });

      const conflict = await http()
        .patch('/api/v1/farm')
        .set(admin)
        .send({ version: farm.version, settings: { codeReuse: false } })
        .expect(409);
      expect(conflict.body).toMatchObject({
        code: 'CODE_REUSE_CONFLICT',
        context: { animalIds: `${fresh.id},${old.id}` },
      });
      expect(conflict.body.detail).toContain('5 y 5');

      // Sin repetidos, se puede.
      await http()
        .post(`/api/v1/animals/${fresh.id}/archive`)
        .set(admin)
        .send({ reason: 'Duplicado' })
        .expect(201);
      await http()
        .patch('/api/v1/farm')
        .set(admin)
        .send({ version: farm.version, settings: { codeReuse: false } })
        .expect(200);
    });
  });

  describe('POST /animals/:id/revert-exit (ANI-04 CA5, IDN-06 CA3)', () => {
    it('sin conflicto: anula la venta, reactiva la chapeta y vuelve al inventario', async () => {
      const animal = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      await sell(admin, animal.id).expect(201);

      const reverted = (
        await http()
          .post(`/api/v1/animals/${animal.id}/revert-exit`)
          .set(admin)
          .send({})
          .expect(201)
      ).body as AnimalDetailWithWarnings;
      expect(reverted).toMatchObject({ status: 'ACTIVE', exit: null, code: '5', warnings: [] });
      expect(reverted.identifiers[0]).toMatchObject({ retiredAt: null, retireReason: null });
      const sale = await prisma.sale.findFirstOrThrow({ where: { animalId: animal.id } });
      expect(sale.voidedAt).not.toBeNull();
    });

    it('su número lo tiene otro activo: CODE_REASSIGNED con ese animal; con newCode, revierte y avisa de la chapeta', async () => {
      const old = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      await sell(admin, old.id).expect(201);
      const fresh = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });

      const conflict = await http()
        .post(`/api/v1/animals/${old.id}/revert-exit`)
        .set(admin)
        .send({})
        .expect(409);
      expect(conflict.body).toMatchObject({
        code: 'CODE_REASSIGNED',
        detail:
          'El código 5 ya lo tiene el animal activo 5. Asígnale un código nuevo para revertir la salida.',
        context: { animalId: fresh.id, animalCode: '5' },
      });

      // El código nuevo también se verifica.
      await http()
        .post(`/api/v1/animals/${old.id}/revert-exit`)
        .set(admin)
        .send({ newCode: '05' })
        .expect(409);

      const reverted = (
        await http()
          .post(`/api/v1/animals/${old.id}/revert-exit`)
          .set(admin)
          .send({ newCode: '41' })
          .expect(201)
      ).body as AnimalDetailWithWarnings;
      expect(reverted).toMatchObject({ code: '41', status: 'ACTIVE' });
      expect(reverted.warnings).toEqual([
        {
          code: 'IDENTIFIER_NOT_RESTORED',
          message: 'El identificador 5 ya lo tiene el animal 5: quedó retirado en este animal.',
        },
      ]);
      expect(reverted.identifiers[0]).toMatchObject({ retireReason: 'EXITED' });
    });

    it('solo su chapeta la tiene otro activo: revierte con su código y la chapeta queda retirada', async () => {
      const old = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      await sell(admin, old.id).expect(201);
      const other = await create(admin, retiro, {
        code: '30',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });

      const reverted = (
        await http().post(`/api/v1/animals/${old.id}/revert-exit`).set(admin).send({}).expect(201)
      ).body as AnimalDetailWithWarnings;
      expect(reverted).toMatchObject({ code: '5', status: 'ACTIVE' });
      expect(reverted.warnings).toEqual([
        {
          code: 'IDENTIFIER_NOT_RESTORED',
          message: 'El identificador 5 ya lo tiene el animal 30: quedó retirado en este animal.',
        },
      ]);
      expect(reverted.identifiers[0]).toMatchObject({ value: '5', retireReason: 'EXITED' });

      // La chapeta sigue siendo del otro animal.
      const holder = (await http().get(`/api/v1/animals/${other.id}`).set(admin).expect(200))
        .body as AnimalDetailWithWarnings;
      expect(holder.identifiers[0]).toMatchObject({ value: '5', retiredAt: null });
    });

    it('OPERATOR y VET no pueden; otra finca, 404; un animal activo no se revierte', async () => {
      const animal = await create(admin, retiro, { code: '5' });
      await http().post(`/api/v1/animals/${animal.id}/revert-exit`).set(admin).send({}).expect(422);
      await sell(admin, animal.id).expect(201);
      for (const headers of [operator, vet]) {
        await http()
          .post(`/api/v1/animals/${animal.id}/revert-exit`)
          .set(headers)
          .send({})
          .expect(403);
      }
      await http()
        .post(`/api/v1/animals/${animal.id}/revert-exit`)
        .set(esperanzaAdmin)
        .send({})
        .expect(404);
    });
  });

  describe('Archivo y restauración (ANI-03)', () => {
    it('archivar exige motivo, retira todos los identificadores y lo saca del inventario', async () => {
      const animal = await create(esperanzaAdmin, esperanza, {
        code: '26-001',
        identifiers: [
          { type: 'VISUAL_TAG', value: '26-001' },
          { type: 'DIN', value: 'CO-0001-2345' },
        ],
      });
      await http()
        .post(`/api/v1/animals/${animal.id}/archive`)
        .set(esperanzaAdmin)
        .send({})
        .expect(422);

      const archived = (
        await http()
          .post(`/api/v1/animals/${animal.id}/archive`)
          .set(esperanzaAdmin)
          .send({ reason: 'Registro duplicado por error' })
          .expect(201)
      ).body as AnimalDetailWithWarnings;
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.archive).toMatchObject({ reason: 'Registro duplicado por error' });
      expect(archived.identifiers.map((identifier) => identifier.retireReason)).toEqual([
        'ARCHIVED',
        'ARCHIVED',
      ]);

      const list = await http().get('/api/v1/animals').set(esperanzaAdmin).expect(200);
      expect(list.body.total).toBe(0);
      const archivedList = await http()
        .get('/api/v1/animals')
        .query({ status: 'archived' })
        .set(esperanzaAdmin)
        .expect(200);
      expect(archivedList.body.items.map((item: { id: string }) => item.id)).toEqual([animal.id]);
    });

    it('restaurar: ANIMAL_CODE_TAKEN si otro tomó el código; con newCode, reactiva lo libre y avisa', async () => {
      const animal = await create(esperanzaAdmin, esperanza, {
        code: '26-001',
        identifiers: [
          { type: 'VISUAL_TAG', value: '26-001' },
          { type: 'DIN', value: 'CO-0001-2345' },
        ],
      });
      await http()
        .post(`/api/v1/animals/${animal.id}/archive`)
        .set(esperanzaAdmin)
        .send({ reason: 'Duplicado' })
        .expect(201);
      // El animal real toma el código y el DIN mientras el duplicado está archivado.
      const real = await create(esperanzaAdmin, esperanza, {
        code: '26-001',
        // Retirado al archivar: reasignarlo sigue pidiendo la confirmación del ADMIN (RN-19).
        identifiers: [{ type: 'DIN', value: 'CO-0001-2345', confirmReuse: true }],
      });

      const taken = await http()
        .post(`/api/v1/animals/${animal.id}/restore`)
        .set(esperanzaAdmin)
        .send({})
        .expect(409);
      expect(taken.body).toMatchObject({
        code: 'ANIMAL_CODE_TAKEN',
        context: { animalId: real.id, animalCode: '26-001' },
      });

      const restored = (
        await http()
          .post(`/api/v1/animals/${animal.id}/restore`)
          .set(esperanzaAdmin)
          .send({ newCode: '26-099' })
          .expect(201)
      ).body as AnimalDetailWithWarnings;
      expect(restored).toMatchObject({ code: '26-099', status: 'ACTIVE', archive: null });
      const byType = Object.fromEntries(
        restored.identifiers.map((identifier) => [identifier.type, identifier]),
      );
      expect(byType.VISUAL_TAG).toMatchObject({ retiredAt: null });
      expect(byType.DIN).toMatchObject({ retireReason: 'ARCHIVED' });
      expect(restored.warnings.map((warning) => warning.code)).toEqual(['IDENTIFIER_NOT_RESTORED']);
    });

    it('OPERATOR y VET no archivan ni restauran; otra finca, 404', async () => {
      const animal = await create(admin, retiro, { code: '5' });
      for (const headers of [operator, vet]) {
        await http()
          .post(`/api/v1/animals/${animal.id}/archive`)
          .set(headers)
          .send({ reason: 'Duplicado' })
          .expect(403);
        await http().post(`/api/v1/animals/${animal.id}/restore`).set(headers).send({}).expect(403);
      }
      await http()
        .post(`/api/v1/animals/${animal.id}/archive`)
        .set(esperanzaAdmin)
        .send({ reason: 'Duplicado' })
        .expect(404);
    });
  });

  describe('GET /audit (AUD-01 CA2)', () => {
    it('por animal: el animal, sus identificadores y su venta, con nombres en vez de ids y con montos (solo ADMIN, M7)', async () => {
      const lotId = uuidv7();
      await prisma.lot.create({ data: { id: lotId, farmId: retiro.farmId, name: 'Levante' } });
      const animal = await create(admin, retiro, {
        code: '5',
        identifiers: [{ type: 'VISUAL_TAG', value: '5' }],
      });
      await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(admin)
        .send({ version: 1, lotId })
        .expect(200);
      await sell(admin, animal.id).expect(201);

      const page = (
        await http().get('/api/v1/audit').query({ animalId: animal.id }).set(admin).expect(200)
      ).body as AuditPage;
      expect(page.items.map((item) => [item.entity, item.action])).toEqual([
        ['Animal', 'EXIT'],
        ['Identifier', 'UPDATE'],
        ['Sale', 'CREATE'],
        ['Animal', 'UPDATE'],
        ['Animal', 'CREATE'],
      ]);
      const edit = page.items.find((item) => item.action === 'UPDATE' && item.entity === 'Animal');
      expect(edit?.changes).toContainEqual({ field: 'lotId', before: null, after: 'Levante' });
      expect(edit?.entityLabel).toBe('5');
      expect(edit?.user?.name).toBe('Usuario de El Retiro');
      // M7: /audit es solo del ADMIN, que ve los montos (RN-20).
      const sale = page.items.find((item) => item.entity === 'Sale');
      expect(sale?.animalCode).toBe('5');
      expect(sale?.entityDate).toBe('2026-09-20');
      expect(sale?.changes).toContainEqual({ field: 'amount', before: null, after: '3500000.00' });
    });

    it('pagina y filtra por entidad y fechas', async () => {
      for (const code of ['1', '2', '3']) await create(admin, retiro, { code });
      const first = (
        await http()
          .get('/api/v1/audit')
          .query({ entity: 'Animal', limit: '2', from: '2026-09-25', to: '2026-09-25' })
          .set(admin)
          .expect(200)
      ).body as AuditPage;
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = (
        await http()
          .get('/api/v1/audit')
          .query({ entity: 'Animal', limit: '2', cursor: first.nextCursor })
          .set(admin)
          .expect(200)
      ).body as AuditPage;
      expect(second.items).toHaveLength(1);
      const empty = (
        await http().get('/api/v1/audit').query({ from: '2026-09-26' }).set(admin).expect(200)
      ).body as AuditPage;
      expect(empty.items).toEqual([]);
    });

    it('OPERATOR y VET no consultan; el animal de otra finca es 404 y nada se filtra', async () => {
      const animal = await create(admin, retiro, { code: '5' });
      for (const headers of [operator, vet]) {
        await http().get('/api/v1/audit').set(headers).expect(403);
      }
      await http()
        .get('/api/v1/audit')
        .query({ animalId: animal.id })
        .set(esperanzaAdmin)
        .expect(404);
      const other = (await http().get('/api/v1/audit').set(esperanzaAdmin).expect(200))
        .body as AuditPage;
      expect(other.items).toEqual([]);
    });
  });
});
