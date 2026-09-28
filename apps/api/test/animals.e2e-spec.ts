import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ROLE,
  toIsoDate,
  uuidv7,
  type AnimalDetail,
  type AnimalDetailWithWarnings,
  type AnimalList,
  type IdentifierView,
  type ReplaceIdentifierResult,
  type Role,
  type SearchResult,
  type Timeline,
} from '@hato/shared';
import request from 'supertest';

import { toPrismaDate } from '../src/infra/date-mapper.js';
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
 * Animales e identificadores (M4a: ANI-01 a ANI-08, IDN-01, IDN-02, CLS-02, AUD-01) contra
 * PostgreSQL real, con cada endpoint probado con el rol autorizado, el no autorizado cuando lo
 * hay y un usuario de otra finca (CLAUDE.md, «Convenciones»). «Hoy» es el 25/09/2026.
 */
describe('Animales e identificadores', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let lotId: string;
  let tagId: string;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  const base = () => ({
    code: '26-001',
    sex: 'FEMALE',
    breedId: esperanza.breedId,
    birthDate: '2026-03-01',
    origin: 'BORN_ON_FARM',
  });

  const create = async (
    body: Record<string, unknown>,
    headers = operator,
  ): Promise<AnimalDetailWithWarnings> =>
    (await http().post('/api/v1/animals').set(headers).send(body).expect(201))
      .body as AnimalDetailWithWarnings;

  const auditOf = (entity: string, entityId: string) =>
    prisma.auditLog.findMany({ where: { entity, entityId }, orderBy: { id: 'asc' } });

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
    operator = await as(esperanza, ROLE.OPERATOR);
    vet = await as(esperanza, ROLE.VET);
    lotId = uuidv7();
    await prisma.lot.create({ data: { id: lotId, farmId: esperanza.farmId, name: 'Paridas' } });
    tagId = uuidv7();
    await prisma.tag.create({
      data: { id: tagId, farmId: esperanza.farmId, key: 'COTERO', label: 'Cotero', isSystem: true },
    });
  });

  describe('POST /animals (ANI-01)', () => {
    it('los tres roles registran; responde la ficha con categoría y etiquetas calculadas', async () => {
      for (const [index, headers] of [admin, operator, vet].entries()) {
        const animal = await create({ ...base(), code: `26-00${index + 1}` }, headers);
        expect(animal).toMatchObject({
          code: `26-00${index + 1}`,
          category: 'CALF_FEMALE',
          ageMonths: 6,
          status: 'ACTIVE',
          version: 1,
          warnings: [],
        });
      }
    });

    it('crea identificadores, etiquetas, lote y peso inicial en la misma operación', async () => {
      const animal = await create({
        ...base(),
        lotId,
        tagIds: [tagId],
        identifiers: [
          { type: 'VISUAL_TAG', value: ' 26-001 ' },
          { type: 'RFID', value: '982 000123456789' },
        ],
        initialWeight: { weightKg: 32.5, weighedOn: '2026-03-01', method: 'TAPE' },
      });
      expect(animal.identifiers.map((identifier) => [identifier.type, identifier.value])).toEqual(
        expect.arrayContaining([
          ['VISUAL_TAG', '26-001'],
          ['RFID', '982000123456789'],
        ]),
      );
      expect(animal.manualTags).toEqual([{ id: tagId, key: 'COTERO', label: 'Cotero' }]);
      expect(animal.lot).toEqual({ id: lotId, name: 'Paridas' });
      expect(animal.lastWeight).toEqual({
        weightKg: 32.5,
        weighedOn: '2026-03-01',
        method: 'TAPE',
      });
      // RFID que no empieza por 170: advertencia, no bloqueo (IDN-01 CA3).
      expect(animal.warnings.map((warning) => warning.code)).toEqual(['RFID_FOREIGN_COUNTRY']);
    });

    it('repetir la misma petición con el mismo id no duplica (05, idempotencia)', async () => {
      const id = uuidv7();
      const first = await create({ ...base(), id });
      const second = await create({ ...base(), id });
      expect(second.id).toBe(first.id);
      expect(await prisma.animal.count({ where: { farmId: esperanza.farmId } })).toBe(1);
    });

    it('código duplicado entre no archivados: ANIMAL_CODE_TAKEN (RN-01, CA1)', async () => {
      await create(base());
      const response = await http().post('/api/v1/animals').set(operator).send(base()).expect(409);
      expect(response.body).toMatchObject({
        code: 'ANIMAL_CODE_TAKEN',
        detail: 'Ya existe un animal con el código 26-001.',
      });
    });

    it('el código de un archivado sí se puede usar; el de otra finca también', async () => {
      const old = await createAnimal(prisma, esperanza, { code: '26-001' });
      await prisma.animal.update({
        where: { id: old },
        data: { deletedAt: new Date('2026-09-20T12:00:00.000Z') },
      });
      await create(base());
      await http()
        .post('/api/v1/animals')
        .set(otherAdmin)
        .send({ ...base(), breedId: palmar.breedId })
        .expect(201);
    });

    it('madre hembra y padre macho (RN-02); la madre nació antes', async () => {
      const bull = await createAnimal(prisma, esperanza, {
        code: 'T-1',
        sex: 'MALE',
        birthDate: toIsoDate('2020-01-01'),
      });
      const cow = await createAnimal(prisma, esperanza, {
        code: 'V-1',
        birthDate: toIsoDate('2020-01-01'),
      });

      const asDam = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), damId: bull })
        .expect(422);
      expect(asDam.body.code).toBe('SEX_NOT_ALLOWED');
      const asSire = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), sireId: cow })
        .expect(422);
      expect(asSire.body.code).toBe('SEX_NOT_ALLOWED');

      const young = await createAnimal(prisma, esperanza, {
        code: 'V-2',
        birthDate: toIsoDate('2026-04-01'),
      });
      const older = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), damId: young })
        .expect(422);
      expect(older.body.fieldErrors?.damId ?? older.body.errors?.damId).toBeDefined();

      const ok = await create({ ...base(), damId: cow, sireId: bull });
      expect(ok.dam?.code).toBe('V-1');
      expect(ok.sire?.code).toBe('T-1');
    });

    it('una madre de otra finca no existe para esta', async () => {
      const foreign = await createAnimal(prisma, palmar, {
        code: 'V-9',
        birthDate: toIsoDate('2020-01-01'),
      });
      await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), damId: foreign })
        .expect(422);
    });

    it('madre menor que la edad mínima reproductiva: advertencia DAM_AGE_LOW (RN-23)', async () => {
      const heifer = await createAnimal(prisma, esperanza, {
        code: 'N-1',
        birthDate: toIsoDate('2025-06-01'),
      });
      const calf = await create({ ...base(), damId: heifer });
      expect(calf.warnings).toEqual([
        {
          code: 'DAM_AGE_LOW',
          message:
            'La madre N-1 tenía 9 meses al nacer la cría; la edad mínima reproductiva es 15 meses.',
        },
      ]);
    });

    it('fechas futuras o anteriores al nacimiento (RN-14)', async () => {
      const future = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), birthDate: '2026-09-26' })
        .expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');
      const entry = await http()
        .post('/api/v1/animals')
        .set(admin)
        .send({ ...base(), origin: 'PURCHASED', entryDate: '2026-02-01' })
        .expect(422);
      expect(entry.body.code).toBe('DATE_BEFORE_BIRTH');
      const weight = await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), initialWeight: { weightKg: 30, weighedOn: '2026-02-01' } })
        .expect(422);
      expect(weight.body.code).toBe('DATE_BEFORE_BIRTH');
    });

    it('compra con valor: solo ADMIN, y crea el gasto PURCHASE asignado al 100 % (CA2, RN-20)', async () => {
      const purchase = {
        ...base(),
        origin: 'PURCHASED',
        entryDate: '2026-04-15',
        purchasePrice: '1850000',
      };
      const denied = await http().post('/api/v1/animals').set(operator).send(purchase).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN_ROLE');
      await http().post('/api/v1/animals').set(vet).send(purchase).expect(403);
      expect(await prisma.animal.count()).toBe(0);

      const animal = await create(purchase, admin);
      expect(animal.economics).toEqual({ purchasePrice: '1850000.00' });
      const expense = await prisma.expense.findFirstOrThrow({ include: { allocations: true } });
      expect(expense).toMatchObject({
        type: 'PURCHASE',
        allocationMethod: 'DIRECT',
        farmId: esperanza.farmId,
      });
      expect(expense.amount.toFixed(2)).toBe('1850000.00');
      expect(expense.allocations).toHaveLength(1);
      expect(expense.allocations[0]?.animalId).toBe(animal.id);
      expect(expense.allocations[0]?.amount.toFixed(2)).toBe('1850000.00');

      // Otros roles ven la ficha sin el bloque económico.
      const seen = await http().get(`/api/v1/animals/${animal.id}`).set(operator).expect(200);
      expect(seen.body).not.toHaveProperty('economics');
    });

    it('la compra es atómica: si algo falla después, no queda ni el animal ni el gasto', async () => {
      await createAnimal(prisma, esperanza, { code: 'X-1' });
      await prisma.identifier.create({
        data: {
          id: uuidv7(),
          farmId: esperanza.farmId,
          animalId: (await prisma.animal.findFirstOrThrow()).id,
          type: 'RFID',
          value: '170000000000001',
          assignedAt: toPrismaDate(toIsoDate('2026-01-01')),
        },
      });
      const response = await http()
        .post('/api/v1/animals')
        .set(admin)
        .send({
          ...base(),
          origin: 'PURCHASED',
          entryDate: '2026-04-15',
          purchasePrice: '1850000',
          identifiers: [{ type: 'RFID', value: '170000000000001' }],
        })
        .expect(409);
      expect(response.body.code).toBe('IDENTIFIER_TAKEN');
      expect(await prisma.animal.count({ where: { code: '26-001' } })).toBe(0);
      expect(await prisma.expense.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('«Disponible para venta» solo lo marca ADMIN (CLS-02 CA1)', async () => {
      await http()
        .post('/api/v1/animals')
        .set(operator)
        .send({ ...base(), forSale: true })
        .expect(403);
      expect((await create({ ...base(), forSale: true }, admin)).forSale).toBe(true);
    });

    it('queda en la auditoría, sin montos (AUD-01, RN-20)', async () => {
      const animal = await create(
        { ...base(), origin: 'PURCHASED', entryDate: '2026-04-15', purchasePrice: '1850000' },
        admin,
      );
      const logs = await auditOf('Animal', animal.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'CREATE', userId: esperanza.userId });
      expect(JSON.stringify(logs[0]?.diff)).not.toContain('1850000');
      expect(await prisma.auditLog.count({ where: { entity: 'Expense' } })).toBe(1);
    });
  });

  describe('GET /animals/:id y aislamiento por finca (RN-21)', () => {
    it('un usuario de otra finca no ve la ficha, la línea de tiempo ni la genealogía', async () => {
      const animal = await create(base());
      for (const path of ['', '/timeline', '/genealogy']) {
        const response = await http()
          .get(`/api/v1/animals/${animal.id}${path}`)
          .set(otherAdmin)
          .expect(404);
        expect(response.body.code).toBe('NOT_FOUND');
      }
      const list = await http().get('/api/v1/animals').set(otherAdmin).expect(200);
      expect((list.body as AnimalList).total).toBe(0);
      const search = await http()
        .get('/api/v1/animals/search?q=26-001')
        .set(otherAdmin)
        .expect(200);
      expect(search.body).toEqual({ exactMatch: null, items: [] });
    });

    it('sin token, 401', async () => {
      await http().get('/api/v1/animals').expect(401);
    });

    it('un id que no es UUID se rechaza sin llegar a la base', async () => {
      const response = await http().get('/api/v1/animals/no-es-un-uuid').set(operator).expect(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
    });
  });

  describe('PATCH /animals/:id (ANI-02)', () => {
    it('edita con la versión, audita antes y después, y cambiar el lote deja un movimiento', async () => {
      const animal = await create(base());
      const response = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(vet)
        .send({ version: 1, name: 'Canela', lotId })
        .expect(200);
      expect(response.body).toMatchObject({ name: 'Canela', version: 2, lot: { id: lotId } });

      const [, update] = await auditOf('Animal', animal.id);
      expect(update?.diff).toEqual({
        changed: ['name', 'lotId'],
        before: { name: null, lotId: null },
        after: { name: 'Canela', lotId },
      });
      expect(await prisma.lotMovement.count({ where: { animalId: animal.id } })).toBe(1);

      const conflict = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(operator)
        .send({ version: 1, name: 'Otra' })
        .expect(409);
      expect(conflict.body.code).toBe('VERSION_CONFLICT');
    });

    it('otra finca: 404', async () => {
      const animal = await create(base());
      await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(otherAdmin)
        .send({ version: 1, name: 'X' })
        .expect(404);
    });

    it('con salida registrada solo admite observaciones y foto (RN-09)', async () => {
      const animal = await create(base());
      await prisma.animal.update({
        where: { id: animal.id },
        data: { exitType: 'SALE', exitDate: toPrismaDate(toIsoDate('2026-09-20')) },
      });
      const denied = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(operator)
        .send({ version: 1, name: 'No' })
        .expect(409);
      expect(denied.body.code).toBe('ANIMAL_EXITED');
      const allowed = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(operator)
        .send({ version: 1, notes: 'Vendida a la finca vecina' })
        .expect(200);
      expect(allowed.body).toMatchObject({ notes: 'Vendida a la finca vecina', status: 'SOLD' });
    });

    it('un archivado no admite ediciones y no aparece en listados ni búsqueda (ANI-03 CA2)', async () => {
      const animal = await create(base());
      await prisma.animal.update({
        where: { id: animal.id },
        data: { deletedAt: new Date('2026-09-20T12:00:00.000Z') },
      });
      const response = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(operator)
        .send({ version: 1, notes: 'x' })
        .expect(409);
      expect(response.body.code).toBe('ANIMAL_ARCHIVED');
      expect((await http().get('/api/v1/animals').set(admin).expect(200)).body.total).toBe(0);
      const search = (await http().get('/api/v1/animals/search?q=26-001').set(admin).expect(200))
        .body as SearchResult;
      expect(search.items).toEqual([]);
      const archived = await http().get('/api/v1/animals?status=archived').set(admin).expect(200);
      expect(archived.body.total).toBe(1);
    });

    it('valor de compra y «Disponible para venta»: solo ADMIN', async () => {
      const animal = await create({ ...base(), origin: 'PURCHASED', entryDate: '2026-04-15' });
      await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(operator)
        .send({ version: 1, purchasePrice: '10' })
        .expect(403);
      await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(vet)
        .send({ version: 1, forSale: true })
        .expect(403);

      const withPrice = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(admin)
        .send({ version: 1, purchasePrice: '2000000.50' })
        .expect(200);
      expect(withPrice.body.economics).toEqual({ purchasePrice: '2000000.50' });
      const changed = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(admin)
        .send({ version: 2, purchasePrice: '2100000' })
        .expect(200);
      expect(changed.body.economics).toEqual({ purchasePrice: '2100000.00' });
      expect(await prisma.expense.count({ where: { voidedAt: null } })).toBe(1);
      const removed = await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(admin)
        .send({ version: 3, purchasePrice: null })
        .expect(200);
      expect(removed.body.economics).toEqual({ purchasePrice: null });
      // Anulado, no borrado (RN-11).
      expect(await prisma.expense.count()).toBe(1);
    });

    it('no deja cambiar el sexo de una hembra con partos ni mover el nacimiento después de sus eventos', async () => {
      const cow = await create({ ...base(), birthDate: '2020-01-01', code: 'V-1' });
      await create({ ...base(), damId: cow.id });
      const sex = await http()
        .patch(`/api/v1/animals/${cow.id}`)
        .set(operator)
        .send({ version: 1, sex: 'MALE' })
        .expect(422);
      expect(sex.body.code).toBe('SEX_NOT_ALLOWED');
      const birth = await http()
        .patch(`/api/v1/animals/${cow.id}`)
        .set(operator)
        .send({ version: 1, birthDate: '2026-05-01' })
        .expect(422);
      expect(birth.body.code).toBe('DATE_BEFORE_BIRTH');
    });

    it('la edición aparece en la línea de tiempo, sin repetir el cambio de lote', async () => {
      const animal = await create(base());
      await http()
        .patch(`/api/v1/animals/${animal.id}`)
        .set(operator)
        .send({ version: 1, name: 'Canela', lotId })
        .expect(200);
      const timeline = (
        await http().get(`/api/v1/animals/${animal.id}/timeline`).set(operator).expect(200)
      ).body as Timeline;
      // La edición y el movimiento de lote ocurren en el mismo instante; el nacimiento, antes.
      const kinds = timeline.items.map((item) => item.kind);
      expect(kinds.slice(0, 2).sort()).toEqual(['EDIT', 'LOT_MOVEMENT']);
      expect(kinds[2]).toBe('BIRTH');
      const edit = timeline.items.find((item) => item.kind === 'EDIT');
      expect(edit?.kind === 'EDIT' && edit.data.changes).toEqual([
        { field: 'name', before: null, after: 'Canela' },
      ]);
    });
  });

  describe('operaciones en lote (CLS-02 CA2)', () => {
    it('agrega y quita etiquetas manuales a varios animales, con auditoría por animal', async () => {
      const first = await create(base());
      const second = await create({ ...base(), code: '26-002' });
      const response = await http()
        .post('/api/v1/animals/bulk/tags')
        .set(operator)
        .send({ animalIds: [first.id, second.id], add: [tagId] })
        .expect(201);
      expect(response.body).toEqual({ updated: 2 });
      expect(
        (await http().get('/api/v1/animals?tags=COTERO').set(operator).expect(200)).body.total,
      ).toBe(2);
      expect((await auditOf('Animal', first.id)).at(-1)?.diff).toMatchObject({
        changed: ['tagIds'],
      });

      await http()
        .post('/api/v1/animals/bulk/tags')
        .set(vet)
        .send({ animalIds: [first.id], remove: [tagId] })
        .expect(201);
      expect(
        (await http().get('/api/v1/animals?tags=COTERO').set(operator).expect(200)).body.total,
      ).toBe(1);
    });

    it('«Disponible para venta» en lote solo ADMIN', async () => {
      const animal = await create(base());
      await http()
        .post('/api/v1/animals/bulk/tags')
        .set(operator)
        .send({ animalIds: [animal.id], forSale: true })
        .expect(403);
      await http()
        .post('/api/v1/animals/bulk/tags')
        .set(admin)
        .send({ animalIds: [animal.id], forSale: true })
        .expect(201);
      expect(
        (await http().get('/api/v1/animals?forSale=true').set(operator).expect(200)).body.total,
      ).toBe(1);
    });

    it('todo o nada: un animal de otra finca o con salida anula la operación', async () => {
      const mine = await create(base());
      const foreign = await createAnimal(prisma, palmar, { code: 'P-1' });
      await http()
        .post('/api/v1/animals/bulk/tags')
        .set(operator)
        .send({ animalIds: [mine.id, foreign], add: [tagId] })
        .expect(404);
      const exited = await create({ ...base(), code: '26-002' });
      await prisma.animal.update({
        where: { id: exited.id },
        data: { exitType: 'DEATH', exitDate: toPrismaDate(toIsoDate('2026-09-01')) },
      });
      const response = await http()
        .post('/api/v1/animals/bulk/lot')
        .set(operator)
        .send({ animalIds: [mine.id, exited.id], lotId, date: '2026-09-25' })
        .expect(409);
      expect(response.body.code).toBe('ANIMAL_EXITED');
      expect(await prisma.animalTag.count()).toBe(0);
      expect(await prisma.lotMovement.count()).toBe(0);
    });

    it('cambio de lote en lote: un movimiento por animal que cambia (RN-14 en la fecha)', async () => {
      const first = await create({ ...base(), lotId });
      const second = await create({ ...base(), code: '26-002' });
      const otherLot = uuidv7();
      await prisma.lot.create({
        data: { id: otherLot, farmId: esperanza.farmId, name: 'Levante' },
      });

      const future = await http()
        .post('/api/v1/animals/bulk/lot')
        .set(operator)
        .send({ animalIds: [first.id], lotId: otherLot, date: '2026-09-26' })
        .expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');

      const response = await http()
        .post('/api/v1/animals/bulk/lot')
        .set(vet)
        .send({ animalIds: [first.id, second.id], lotId, date: '2026-09-20' })
        .expect(201);
      expect(response.body).toEqual({ moved: 1, unchanged: 1 });
      const movement = await prisma.lotMovement.findFirstOrThrow({
        where: { animalId: second.id },
      });
      expect(movement).toMatchObject({ fromLotId: null, toLotId: lotId });
    });
  });

  describe('identificadores (IDN-01, IDN-02)', () => {
    it('agregar: valida RFID de 15 dígitos y normaliza el DIN', async () => {
      const animal = await create(base());
      const bad = await http()
        .post(`/api/v1/animals/${animal.id}/identifiers`)
        .set(operator)
        .send({ type: 'RFID', value: '17000012345' })
        .expect(422);
      expect(bad.body.code).toBe('IDENTIFIER_INVALID_RFID');
      const din = await http()
        .post(`/api/v1/animals/${animal.id}/identifiers`)
        .set(vet)
        .send({ type: 'DIN', value: 'co 1365-7001', assignedAt: '2026-05-01' })
        .expect(201);
      expect(din.body).toMatchObject({
        type: 'DIN',
        value: 'CO13657001',
        assignedAt: '2026-05-01',
        retiredAt: null,
      });
    });

    it('un valor activo es único por finca y tipo (RN-19), pero puede repetirse en otra finca', async () => {
      const first = await create(base());
      const second = await create({ ...base(), code: '26-002' });
      await http()
        .post(`/api/v1/animals/${first.id}/identifiers`)
        .set(operator)
        .send({ type: 'VISUAL_TAG', value: '87' })
        .expect(201);
      const taken = await http()
        .post(`/api/v1/animals/${second.id}/identifiers`)
        .set(operator)
        .send({ type: 'VISUAL_TAG', value: '87' })
        .expect(409);
      expect(taken.body).toMatchObject({
        code: 'IDENTIFIER_TAKEN',
        detail: 'El identificador 87 ya está asignado al animal 26-001.',
        // Para que la interfaz enlace a la ficha del animal que lo tiene.
        context: { animalId: first.id, animalCode: '26-001' },
      });
      // Otro tipo con el mismo valor sí.
      await http()
        .post(`/api/v1/animals/${second.id}/identifiers`)
        .set(operator)
        .send({ type: 'OTHER', value: '87' })
        .expect(201);
      const foreign = await createAnimal(prisma, palmar, { code: 'P-1' });
      await http()
        .post(`/api/v1/animals/${foreign}/identifiers`)
        .set(otherAdmin)
        .send({ type: 'VISUAL_TAG', value: '87' })
        .expect(201);
    });

    it('otra finca: no puede agregar, reemplazar ni retirar', async () => {
      const animal = await create(base());
      const added = (
        await http()
          .post(`/api/v1/animals/${animal.id}/identifiers`)
          .set(operator)
          .send({ type: 'DIN', value: 'CO1' })
          .expect(201)
      ).body as IdentifierView;
      await http()
        .post(`/api/v1/animals/${animal.id}/identifiers`)
        .set(otherAdmin)
        .send({ type: 'DIN', value: 'CO2' })
        .expect(404);
      await http()
        .post(`/api/v1/identifiers/${added.id}/replace`)
        .set(otherAdmin)
        .send({ reason: 'LOST', newValue: 'CO3', date: '2026-09-01' })
        .expect(404);
      await http()
        .post(`/api/v1/identifiers/${added.id}/retire`)
        .set(otherAdmin)
        .send({ reason: 'LOST', date: '2026-09-01' })
        .expect(404);
    });

    it('reemplazar: el anterior queda retirado, enlazado y visible; todo auditado', async () => {
      const animal = await create(base());
      const tag = (
        await http()
          .post(`/api/v1/animals/${animal.id}/identifiers`)
          .set(operator)
          .send({ type: 'VISUAL_TAG', value: '87', assignedAt: '2026-04-01' })
          .expect(201)
      ).body as IdentifierView;
      const result = (
        await http()
          .post(`/api/v1/identifiers/${tag.id}/replace`)
          .set(vet)
          .send({ reason: 'DAMAGED', newValue: '87B', date: '2026-09-10' })
          .expect(201)
      ).body as ReplaceIdentifierResult;
      expect(result.previous).toMatchObject({
        value: '87',
        retiredAt: '2026-09-10',
        retireReason: 'DAMAGED',
        replacedById: result.current.id,
      });
      expect(result.current).toMatchObject({
        value: '87B',
        assignedAt: '2026-09-10',
        retiredAt: null,
      });

      const detail = (await http().get(`/api/v1/animals/${animal.id}`).set(operator).expect(200))
        .body as AnimalDetail;
      expect(detail.identifiers.map((identifier) => identifier.value)).toEqual(['87B', '87']);
      expect(await prisma.auditLog.count({ where: { entity: 'Identifier' } })).toBe(3);

      // Ya retirado: no se vuelve a retirar ni reemplazar.
      await http()
        .post(`/api/v1/identifiers/${tag.id}/retire`)
        .set(operator)
        .send({ reason: 'LOST', date: '2026-09-11' })
        .expect(422);

      const timeline = (
        await http().get(`/api/v1/animals/${animal.id}/timeline`).set(operator).expect(200)
      ).body as Timeline;
      expect(timeline.items.map((item) => item.kind)).toEqual(
        expect.arrayContaining(['IDENTIFIER_ASSIGNED', 'IDENTIFIER_RETIRED']),
      );
    });

    it('reasignar un valor retirado de otro animal exige confirmación de ADMIN (RN-19)', async () => {
      const first = await create(base());
      const second = await create({ ...base(), code: '26-002' });
      const tag = (
        await http()
          .post(`/api/v1/animals/${first.id}/identifiers`)
          .set(operator)
          .send({ type: 'VISUAL_TAG', value: '87', assignedAt: '2026-04-01' })
          .expect(201)
      ).body as IdentifierView;
      await http()
        .post(`/api/v1/identifiers/${tag.id}/retire`)
        .set(operator)
        .send({ reason: 'LOST', date: '2026-09-01' })
        .expect(201);

      const unconfirmed = await http()
        .post(`/api/v1/animals/${second.id}/identifiers`)
        .set(admin)
        .send({ type: 'VISUAL_TAG', value: '87' })
        .expect(409);
      expect(unconfirmed.body).toMatchObject({
        code: 'IDENTIFIER_PREVIOUSLY_USED',
        detail:
          'El identificador 87 perteneció al animal 26-001. Solo un administrador puede reasignarlo.',
        context: { animalId: first.id, animalCode: '26-001' },
      });
      await http()
        .post(`/api/v1/animals/${second.id}/identifiers`)
        .set(operator)
        .send({ type: 'VISUAL_TAG', value: '87', confirmReuse: true })
        .expect(403);
      await http()
        .post(`/api/v1/animals/${second.id}/identifiers`)
        .set(admin)
        .send({ type: 'VISUAL_TAG', value: '87', confirmReuse: true })
        .expect(201);
      // El mismo animal sí puede recuperar su propio identificador sin confirmar.
      await http()
        .post(`/api/v1/animals/${first.id}/identifiers`)
        .set(operator)
        .send({ type: 'DIN', value: 'CO9' })
        .expect(201);
    });

    it('fechas: ni futuras ni anteriores al nacimiento; con salida, ANIMAL_EXITED (RN-09, RN-14)', async () => {
      const animal = await create(base());
      const future = await http()
        .post(`/api/v1/animals/${animal.id}/identifiers`)
        .set(operator)
        .send({ type: 'DIN', value: 'CO1', assignedAt: '2026-10-01' })
        .expect(422);
      expect(future.body.code).toBe('DATE_IN_FUTURE');
      const early = await http()
        .post(`/api/v1/animals/${animal.id}/identifiers`)
        .set(operator)
        .send({ type: 'DIN', value: 'CO1', assignedAt: '2026-01-01' })
        .expect(422);
      expect(early.body.code).toBe('DATE_BEFORE_BIRTH');

      await prisma.animal.update({
        where: { id: animal.id },
        data: { exitType: 'SALE', exitDate: toPrismaDate(toIsoDate('2026-09-20')) },
      });
      const exited = await http()
        .post(`/api/v1/animals/${animal.id}/identifiers`)
        .set(operator)
        .send({ type: 'DIN', value: 'CO1' })
        .expect(409);
      expect(exited.body.code).toBe('ANIMAL_EXITED');
    });
  });

  describe('GET /animals/next-code (RN-28)', () => {
    it('usa el patrón de la finca y todos los roles lo consultan; otra finca tiene su propia cuenta', async () => {
      await create(base());
      for (const headers of [admin, operator, vet]) {
        const response = await http()
          .get('/api/v1/animals/next-code?birthDate=2026-05-01')
          .set(headers)
          .expect(200);
        expect(response.body).toEqual({ code: '26-002' });
      }
      expect(
        (await http().get('/api/v1/animals/next-code').set(otherAdmin).expect(200)).body,
      ).toEqual({
        code: '26-001',
      });
      await prisma.farm.update({
        where: { id: esperanza.farmId },
        data: {
          settings: {
            ...((await prisma.farm.findUniqueOrThrow({ where: { id: esperanza.farmId } }))
              .settings as object),
            calfCodePattern: 'LE-{YYYY}-{N}',
          },
        },
      });
      expect(
        (await http().get('/api/v1/animals/next-code').set(operator).expect(200)).body,
      ).toEqual({
        code: 'LE-2026-1',
      });
    });
  });

  describe('etiquetas manuales y derivadas no chocan', () => {
    it('una etiqueta llamada «Served» no toma la clave de la derivada', async () => {
      const response = await http()
        .post('/api/v1/tags')
        .set(admin)
        .send({ label: 'Served' })
        .expect(201);
      expect(response.body.key).toBe('SERVED_2');
    });
  });
});
