import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  DEFAULT_FARM_SETTINGS,
  ROLE,
  toIsoDate,
  uuidv7,
  type AnimalDetail,
  type BirthsReport,
  type CalvingResult,
  type PregnancyView,
  type PregnancyWithWarnings,
  type Role,
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
 * Reproducción y nacimientos (M5: REP-01 a REP-05, NAC-01, CU-01) contra PostgreSQL real. Cada
 * endpoint con los roles autorizados, el no autorizado cuando lo hay y un usuario de otra finca.
 * «Hoy» es el 25/09/2026. La raza de las fincas de prueba (Brahman) gesta 293 días.
 */
describe('Reproducción y nacimientos', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let cow: string;
  let bull: string;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  const serve = (damId: string, body: Record<string, unknown> = {}, headers = operator) =>
    http()
      .post('/api/v1/pregnancies')
      .set(headers)
      .send({ damId, serviceDate: '2026-01-12', method: 'AI', ...body });

  const calve = (body: Record<string, unknown>, headers = operator) =>
    http()
      .post('/api/v1/calvings')
      .set(headers)
      .send({ damId: cow, date: '2026-09-20', calvingType: 'NORMAL', ...body });

  const detail = async (id: string) =>
    (await http().get(`/api/v1/animals/${id}`).set(admin).expect(200)).body as AnimalDetail;

  const pregnancyRow = (id: string) => prisma.pregnancy.findUniqueOrThrow({ where: { id } });

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
    cow = await createAnimal(prisma, esperanza, {
      code: '087',
      birthDate: toIsoDate('2019-03-12'),
    });
    bull = await createAnimal(prisma, esperanza, {
      code: 'T-1',
      sex: 'MALE',
      birthDate: toIsoDate('2018-01-01'),
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /pregnancies: servicio (REP-01)', () => {
    it.each([
      ['ADMIN', () => admin],
      ['OPERATOR', () => operator],
      ['VET', () => vet],
    ])(
      '%s registra el servicio y ve el parto estimado con la gestación de la raza (RN-04)',
      async (_role, headers) => {
        const response = await serve(cow, { sireId: bull }, headers()).expect(201);
        const pregnancy = response.body as PregnancyWithWarnings;
        expect(pregnancy).toMatchObject({
          serviceDate: '2026-01-12',
          serviceDateEstimated: false,
          method: 'AI',
          sire: { id: bull, code: 'T-1' },
          confirmedAt: null,
          // 12/01/2026 + 293 días (Brahman).
          expectedCalvingDate: '2026-11-01',
          outcome: 'PENDING',
          gestationDays: 256,
          warnings: [],
        });
        expect((await detail(cow)).derivedTags).toEqual(['SERVED']);
        expect(
          await prisma.auditLog.count({ where: { entity: 'Pregnancy', action: 'CREATE' } }),
        ).toBe(1);
      },
    );

    it('otra finca no puede servir una hembra de esta finca', async () => {
      const response = await serve(cow, {}, otherAdmin).expect(422);
      expect(response.body.errors).toHaveProperty('damId');
      expect(await prisma.pregnancy.count()).toBe(0);
    });

    it('RN-03: con una preñez abierta se rechaza y trae la preñez para ir a cerrarla', async () => {
      const first = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await serve(cow, { serviceDate: '2026-02-01' }).expect(409);
      expect(response.body).toMatchObject({
        code: 'PREGNANCY_ALREADY_OPEN',
        context: { pregnancyId: first.id },
      });
    });

    it('RN-02: un macho no se sirve y el toro debe ser macho', async () => {
      expect((await serve(bull).expect(422)).body.code).toBe('SEX_NOT_ALLOWED');
      const heifer = await createAnimal(prisma, esperanza, { code: '200' });
      const response = await serve(cow, { sireId: heifer }).expect(422);
      expect(response.body).toMatchObject({ code: 'SEX_NOT_ALLOWED' });
      expect(response.body.errors).toHaveProperty('sireId');
    });

    it('RN-14: ni futuro ni anterior al nacimiento', async () => {
      expect((await serve(cow, { serviceDate: '2026-09-26' }).expect(422)).body.code).toBe(
        'DATE_IN_FUTURE',
      );
      expect((await serve(cow, { serviceDate: '2019-01-01' }).expect(422)).body.code).toBe(
        'DATE_BEFORE_BIRTH',
      );
    });

    it('RN-15: una novilla joven se sirve con advertencia, sin bloqueo', async () => {
      const young = await createAnimal(prisma, esperanza, {
        code: '300',
        birthDate: toIsoDate('2025-09-15'),
      });
      const response = await serve(young, { serviceDate: '2026-09-01' }).expect(201);
      expect(response.body.warnings.map((warning: { code: string }) => warning.code)).toEqual([
        'BREEDING_AGE_LOW',
      ]);
    });

    it('RN-09: una hembra que salió o está archivada no admite servicio', async () => {
      await prisma.animal.update({
        where: { id: cow },
        data: { exitType: 'SALE', exitDate: toPrismaDate(toIsoDate('2026-09-01')) },
      });
      expect((await serve(cow).expect(409)).body.code).toBe('ANIMAL_EXITED');
    });

    it('el servicio debe ser posterior al último parto', async () => {
      await calve({ calves: [{ sex: 'MALE', health: 'ALIVE' }] }).expect(201);
      const response = await serve(cow, { serviceDate: '2026-09-10' }).expect(422);
      expect(response.body.errors).toHaveProperty('serviceDate');
    });

    it('REP-02 CA3: preñez confirmada sin servicio conocido, con servicio estimado', async () => {
      const response = await http()
        .post('/api/v1/pregnancies')
        .set(vet)
        .send({
          damId: cow,
          gestationMonths: 4,
          diagnosisDate: '2026-09-20',
          diagnosisResponsible: 'Dra. Paola',
          diagnosisNotes: 'Feto de unos cuatro meses.',
        })
        .expect(201);
      expect(response.body).toMatchObject({
        serviceDate: '2026-05-20',
        serviceDateEstimated: true,
        method: 'UNKNOWN',
        confirmedAt: '2026-09-20',
        diagnosisResponsible: 'Dra. Paola',
        diagnosisNotes: 'Feto de unos cuatro meses.',
        notes: null,
        expectedCalvingDate: '2027-03-09',
      });
      expect((await detail(cow)).derivedTags).toEqual(['PREGNANT']);
    });

    it('ADR-012: el mismo id con el mismo contenido → 200; con otro → CLIENT_ID_CONFLICT', async () => {
      const id = uuidv7();
      await serve(cow, { id }).expect(201);
      const again = await serve(cow, { id }).expect(200);
      expect(again.body.id).toBe(id);
      const conflict = await serve(cow, { id, method: 'NATURAL' }).expect(409);
      expect(conflict.body.code).toBe('CLIENT_ID_CONFLICT');
      expect(await prisma.pregnancy.count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /pregnancies/:id/diagnosis (REP-02)', () => {
    it.each([
      ['OPERATOR', () => operator],
      ['VET', () => vet],
    ])('%s: positiva → Preñada; queda quién palpó', async (_role, headers) => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(headers())
        .send({ date: '2026-03-20', result: 'POSITIVE', responsible: 'Dra. Paola' })
        .expect(201);
      expect(response.body).toMatchObject({
        confirmedAt: '2026-03-20',
        diagnosisResponsible: 'Dra. Paola',
        outcome: 'PENDING',
      });
      expect((await detail(cow)).derivedTags).toEqual(['PREGNANT']);
    });

    it('M6: las observaciones de la palpación quedan aparte de las de la preñez', async () => {
      const { id } = (await serve(cow, { notes: 'Servicio con el toro del lote' }).expect(201))
        .body as PregnancyView;
      const first = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-03-20', result: 'POSITIVE', notes: 'Útero con buen tono.' })
        .expect(201);
      expect(first.body).toMatchObject({
        diagnosisNotes: 'Útero con buen tono.',
        notes: 'Servicio con el toro del lote',
      });

      // Una palpación sin observaciones conserva las anteriores; con observaciones, las reemplaza.
      const silent = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-04-20', result: 'POSITIVE' })
        .expect(201);
      expect(silent.body.diagnosisNotes).toBe('Útero con buen tono.');
      const second = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-05-20', result: 'POSITIVE', notes: 'Gestación de tres meses.' })
        .expect(201);
      expect(second.body).toMatchObject({
        diagnosisNotes: 'Gestación de tres meses.',
        notes: 'Servicio con el toro del lote',
      });

      const detailView = await detail(cow);
      expect(detailView.reproduction?.openPregnancy?.diagnosisNotes).toBe(
        'Gestación de tres meses.',
      );
    });

    it('negativa → cierra la preñez vacía (FAILED) y la hembra puede volver a servicio', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-03-20', result: 'NEGATIVE' })
        .expect(201);
      expect(response.body).toMatchObject({ outcome: 'FAILED', outcomeDate: '2026-03-20' });
      await serve(cow, { serviceDate: '2026-04-10' }).expect(201);
    });

    it('una preñez cerrada no admite palpación; antes del servicio tampoco', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      const before = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-01-01', result: 'POSITIVE' })
        .expect(422);
      expect(before.body.errors).toHaveProperty('date');
      await http()
        .post(`/api/v1/pregnancies/${id}/abortion`)
        .set(vet)
        .send({ date: '2026-04-01' })
        .expect(201);
      const closed = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-05-01', result: 'POSITIVE' })
        .expect(409);
      expect(closed.body.code).toBe('PREGNANCY_NOT_OPEN');
    });

    it('otra finca: 404', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(otherAdmin)
        .send({ date: '2026-03-20', result: 'POSITIVE' })
        .expect(404);
    });

    it('Idempotency-Key: la misma palpación repetida no cambia nada más', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      const key = { 'Idempotency-Key': uuidv7() };
      const body = { date: '2026-03-20', result: 'NEGATIVE' };
      const first = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .set(key)
        .send(body)
        .expect(201);
      const again = await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .set(key)
        .send(body)
        .expect(201);
      expect(again.body).toEqual(first.body);
      expect(
        await prisma.auditLog.count({ where: { entity: 'Pregnancy', action: 'UPDATE' } }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /pregnancies/:id/abortion (REP-03)', () => {
    it('cierra con ABORTED, sin crías ni parto', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await http()
        .post(`/api/v1/pregnancies/${id}/abortion`)
        .set(operator)
        .send({ date: '2026-05-02', notes: 'Encontrado en el potrero' })
        .expect(201);
      expect(response.body).toMatchObject({
        outcome: 'ABORTED',
        outcomeDate: '2026-05-02',
        notes: 'Encontrado en el potrero',
        calves: [],
      });
      const cowDetail = await detail(cow);
      expect(cowDetail.calvingCount).toBe(0);
      expect(cowDetail.derivedTags).toEqual([]);
      expect(await prisma.animal.count({ where: { damId: cow } })).toBe(0);
    });

    it('otra finca: 404', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      await http()
        .post(`/api/v1/pregnancies/${id}/abortion`)
        .set(otherAdmin)
        .send({ date: '2026-05-02' })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('PATCH /pregnancies/:id', () => {
    it('corregir el servicio recalcula el parto estimado (RN-04); con version', async () => {
      const created = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await http()
        .patch(`/api/v1/pregnancies/${created.id}`)
        .set(operator)
        .send({ version: created.version, serviceDate: '2026-01-02' })
        .expect(200);
      expect(response.body).toMatchObject({
        serviceDate: '2026-01-02',
        expectedCalvingDate: '2026-10-22',
        expectedCalvingManual: false,
      });
      const stale = await http()
        .patch(`/api/v1/pregnancies/${created.id}`)
        .set(operator)
        .send({ version: created.version, notes: 'x' })
        .expect(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
    });

    it('el parto estimado corregido a mano queda marcado', async () => {
      const created = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await http()
        .patch(`/api/v1/pregnancies/${created.id}`)
        .set(vet)
        .send({ version: created.version, expectedCalvingDate: '2026-10-25' })
        .expect(200);
      expect(response.body).toMatchObject({
        expectedCalvingDate: '2026-10-25',
        expectedCalvingManual: true,
      });
    });

    it('una preñez cerrada no cambia sus fechas', async () => {
      const created = (await serve(cow).expect(201)).body as PregnancyView;
      const aborted = (
        await http()
          .post(`/api/v1/pregnancies/${created.id}/abortion`)
          .set(vet)
          .send({ date: '2026-04-01' })
          .expect(201)
      ).body as PregnancyView;
      await http()
        .patch(`/api/v1/pregnancies/${created.id}`)
        .set(vet)
        .send({ version: aborted.version, serviceDate: '2026-01-05' })
        .expect(422);
      await http()
        .patch(`/api/v1/pregnancies/${created.id}`)
        .set(vet)
        .send({ version: aborted.version, notes: 'Revisado' })
        .expect(200);
    });

    it('otra finca: 404', async () => {
      const created = (await serve(cow).expect(201)).body as PregnancyView;
      await http()
        .patch(`/api/v1/pregnancies/${created.id}`)
        .set(otherAdmin)
        .send({ version: 1, notes: 'x' })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /pregnancies/:id/void (RN-11)', () => {
    it('solo ADMIN; anular dos veces responde 200 con el estado actual', async () => {
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      await http()
        .post(`/api/v1/pregnancies/${id}/void`)
        .set(operator)
        .send({ reason: 'Error de registro' })
        .expect(403);
      await http()
        .post(`/api/v1/pregnancies/${id}/void`)
        .set(otherAdmin)
        .send({ reason: 'Error de registro' })
        .expect(404);
      const voided = await http()
        .post(`/api/v1/pregnancies/${id}/void`)
        .set(admin)
        .send({ reason: 'Error de registro' })
        .expect(201);
      expect(voided.body.voided.reason).toBe('Error de registro');
      await http()
        .post(`/api/v1/pregnancies/${id}/void`)
        .set(admin)
        .send({ reason: 'Error de registro' })
        .expect(200);
      expect((await detail(cow)).derivedTags).toEqual([]);
      // Liberó el lugar de la preñez abierta (RN-03).
      await serve(cow).expect(201);
    });

    it('un parto con crías activas no se anula; archivadas las crías, sí', async () => {
      const calving = (await calve({ calves: [{ sex: 'FEMALE', health: 'ALIVE' }] }).expect(201))
        .body as CalvingResult;
      const response = await http()
        .post(`/api/v1/pregnancies/${calving.pregnancy.id}/void`)
        .set(admin)
        .send({ reason: 'Parto duplicado' })
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'PREGNANCY_HAS_CALVES',
        detail: `Archiva primero las crías de este parto: ${calving.calves[0]?.code}.`,
      });
      await http()
        .post(`/api/v1/animals/${calving.calves[0]?.id}/archive`)
        .set(admin)
        .send({ reason: 'Registro duplicado' })
        .expect(201);
      await http()
        .post(`/api/v1/pregnancies/${calving.pregnancy.id}/void`)
        .set(admin)
        .send({ reason: 'Parto duplicado' })
        .expect(201);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /calvings (REP-04, CU-01)', () => {
    it.each([
      ['ADMIN', () => admin],
      ['OPERATOR', () => operator],
      ['VET', () => vet],
    ])('%s: servicio → palpación → parto con cría (RN-05)', async (_role, headers) => {
      const lotId = uuidv7();
      await prisma.lot.create({ data: { id: lotId, farmId: esperanza.farmId, name: 'Paridas' } });
      await prisma.animal.update({ where: { id: cow }, data: { lotId } });
      const service = (await serve(cow, { sireId: bull }).expect(201)).body as PregnancyView;
      await http()
        .post(`/api/v1/pregnancies/${service.id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-03-20', result: 'POSITIVE' })
        .expect(201);

      const response = await calve(
        {
          calvingType: 'ASSISTED',
          calves: [
            {
              sex: 'MALE',
              health: 'ALIVE',
              birthWeightKg: 32.5,
              identifiers: [{ type: 'VISUAL_TAG', value: '26-001' }],
            },
          ],
        },
        headers(),
      ).expect(201);
      const result = response.body as CalvingResult;
      expect(result.pregnancy).toMatchObject({
        id: service.id,
        outcome: 'CALVED',
        outcomeDate: '2026-09-20',
        calvingType: 'ASSISTED',
        stillbornCount: 0,
      });
      expect(result.calves).toEqual([
        { id: expect.any(String), code: '26-001', name: null, sex: 'MALE' },
      ]);

      const calf = await detail(result.calves[0]?.id as string);
      expect(calf).toMatchObject({
        birthDate: '2026-09-20',
        origin: 'BORN_ON_FARM',
        dam: { id: cow },
        sire: { id: bull },
        breed: { id: esperanza.breedId },
        lot: { id: lotId },
        lastWeight: { weightKg: 32.5, weighedOn: '2026-09-20' },
        category: 'CALF_MALE',
      });
      expect(calf.identifiers.map((identifier) => identifier.value)).toEqual(['26-001']);
      const dam = await detail(cow);
      expect(dam.category).toBe('COW');
      expect(dam.derivedTags).toEqual(['CALVED']);
      expect(dam.reproduction?.lastCalvingDate).toBe('2026-09-20');
      expect(dam.reproduction?.history[0]?.calves.map((ref) => ref.code)).toEqual(['26-001']);
    });

    it('parto gemelar: códigos consecutivos del patrón, una muerta al nacer y una débil', async () => {
      await createAnimal(prisma, esperanza, { code: '26-044' });
      await serve(cow).expect(201);
      const result = (
        await calve({
          calves: [
            { sex: 'FEMALE', health: 'ALIVE' },
            { sex: 'MALE', health: 'WEAK' },
            { sex: 'MALE', health: 'STILLBORN' },
          ],
        }).expect(201)
      ).body as CalvingResult;
      expect(result.calves.map((calf) => calf.code)).toEqual(['26-045', '26-046']);
      expect(result.pregnancy.stillbornCount).toBe(1);
      const weak = await prisma.animal.findUniqueOrThrow({
        where: { id: result.calves[1]?.id as string },
      });
      expect(weak.birthCondition).toBe('WEAK');
      expect(await prisma.animal.count({ where: { damId: cow } })).toBe(2);
    });

    it('LOWEST_FREE (numeración reutilizable): los mellizos toman números libres distintos', async () => {
      await prisma.farm.update({
        where: { id: esperanza.farmId },
        data: {
          settings: { ...DEFAULT_FARM_SETTINGS, codeReuse: true, codeSuggestion: 'LOWEST_FREE' },
        },
      });
      for (const code of ['1', '2', '4']) await createAnimal(prisma, esperanza, { code });
      await prisma.animal.update({ where: { id: cow }, data: { code: '5' } });
      const next = await http().get('/api/v1/animals/next-code?count=2').set(operator).expect(200);
      expect(next.body).toEqual({ code: '3', codes: ['3', '6'] });
      const result = (
        await calve({
          calves: [
            { sex: 'FEMALE', health: 'ALIVE' },
            { sex: 'FEMALE', health: 'ALIVE' },
          ],
        }).expect(201)
      ).body as CalvingResult;
      expect(result.calves.map((calf) => calf.code)).toEqual(['3', '6']);
    });

    it('sin preñez abierta: crea una cerrada con servicio estimado (REP-04 CA1)', async () => {
      const result = (
        await calve({ calves: [{ sex: 'FEMALE', health: 'ALIVE', code: 'C-1' }] }).expect(201)
      ).body as CalvingResult;
      expect(result.pregnancy).toMatchObject({
        serviceDate: '2025-12-01',
        serviceDateEstimated: true,
        method: 'UNKNOWN',
        outcome: 'CALVED',
        calves: [{ code: 'C-1' }],
      });
    });

    it('CA5: si falla la segunda cría no se guarda nada (transacción única)', async () => {
      await createAnimal(prisma, esperanza, { code: 'TOMADO' });
      const service = (await serve(cow).expect(201)).body as PregnancyView;
      const response = await calve({
        calves: [
          { sex: 'FEMALE', health: 'ALIVE', code: 'LIBRE' },
          { sex: 'MALE', health: 'ALIVE', code: 'tomado ' },
        ],
      }).expect(409);
      expect(response.body.code).toBe('ANIMAL_CODE_TAKEN');
      expect(response.body.errors).toHaveProperty(['calves.1.code']);
      expect(await prisma.animal.count({ where: { damId: cow } })).toBe(0);
      expect((await pregnancyRow(service.id)).outcome).toBe('PENDING');
      expect(await prisma.weightRecord.count()).toBe(0);
    });

    it('un identificador repetido en otra cría también deshace todo', async () => {
      const response = await calve({
        calves: [
          { sex: 'FEMALE', health: 'ALIVE', identifiers: [{ type: 'VISUAL_TAG', value: '9' }] },
          { sex: 'MALE', health: 'ALIVE', identifiers: [{ type: 'VISUAL_TAG', value: ' 9' }] },
        ],
      }).expect(422);
      expect(response.body.errors).toHaveProperty(['calves.1.identifiers.0.value']);
      expect(await prisma.pregnancy.count()).toBe(0);
    });

    it('de 1 a 3 crías; una muerta al nacer no lleva código', async () => {
      await calve({ calves: [] }).expect(422);
      await calve({
        calves: Array.from({ length: 4 }, () => ({ sex: 'MALE', health: 'ALIVE' })),
      }).expect(422);
      await calve({ calves: [{ sex: 'MALE', health: 'STILLBORN', code: 'X' }] }).expect(422);
    });

    it('RN-02, RN-14 y otra finca', async () => {
      expect(
        (await calve({ damId: bull, calves: [{ sex: 'MALE', health: 'ALIVE' }] }).expect(422)).body
          .code,
      ).toBe('SEX_NOT_ALLOWED');
      expect(
        (
          await calve({ date: '2026-09-26', calves: [{ sex: 'MALE', health: 'ALIVE' }] }).expect(
            422,
          )
        ).body.code,
      ).toBe('DATE_IN_FUTURE');
      await calve({ calves: [{ sex: 'MALE', health: 'ALIVE' }] }, otherAdmin).expect(422);
      expect(await prisma.pregnancy.count()).toBe(0);
    });

    it('RN-23: una madre por debajo de la edad mínima pare con advertencia', async () => {
      const young = await createAnimal(prisma, esperanza, {
        code: '400',
        birthDate: toIsoDate('2025-07-01'),
      });
      const result = (
        await calve({ damId: young, calves: [{ sex: 'MALE', health: 'ALIVE' }] }).expect(201)
      ).body as CalvingResult;
      expect(result.warnings.map((warning) => warning.code)).toEqual(['DAM_AGE_LOW']);
    });

    it('Idempotency-Key: el mismo parto repetido no duplica crías', async () => {
      const key = { 'Idempotency-Key': uuidv7() };
      const body = { calves: [{ sex: 'FEMALE', health: 'ALIVE' }] };
      const first = await calve(body).set(key).expect(201);
      const again = await calve(body).set(key).expect(201);
      expect(again.body).toEqual(first.body);
      expect(await prisma.animal.count({ where: { damId: cow } })).toBe(1);
    });

    it('ADR-012 sin clave: los mismos id de la cría y de la preñez → 200; otro parto → conflicto', async () => {
      const body = {
        id: uuidv7(),
        calves: [{ id: uuidv7(), sex: 'FEMALE', health: 'ALIVE', code: 'C-9' }],
      };
      const first = (await calve(body).expect(201)).body as CalvingResult;
      const again = (await calve(body).expect(200)).body as CalvingResult;
      expect(again.pregnancy.id).toBe(first.pregnancy.id);
      expect(again.calves.map((calf) => calf.id)).toEqual([body.calves[0]?.id]);
      const conflict = await calve({ ...body, date: '2026-09-21' }).expect(409);
      expect(conflict.body.code).toBe('CLIENT_ID_CONFLICT');
      expect(await prisma.animal.count({ where: { damId: cow } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('Ficha: historial, intervalo entre partos y alertas (REP-05)', () => {
    it('RN-38: el parto con servicio estimado no entra al intervalo', async () => {
      // Parto de 2024 con servicio real y parto de 2025 sin preñez registrada (estimado).
      await serve(cow, { serviceDate: '2023-12-01' }).expect(201);
      await calve({ date: '2024-09-15', calves: [{ sex: 'MALE', health: 'ALIVE' }] }).expect(201);
      await calve({ date: '2025-10-01', calves: [{ sex: 'MALE', health: 'ALIVE' }] }).expect(201);
      let reproduction = (await detail(cow)).reproduction;
      expect(reproduction?.calvingCount).toBe(2);
      expect(reproduction?.calvingInterval).toEqual({ lastDays: null, averageDays: null });

      await serve(cow, { serviceDate: '2025-11-01' }).expect(201);
      await calve({ date: '2026-08-10', calves: [{ sex: 'FEMALE', health: 'ALIVE' }] }).expect(201);
      reproduction = (await detail(cow)).reproduction;
      // 2025 (estimado) → 2026 tampoco cuenta.
      expect(reproduction?.calvingInterval.lastDays).toBeNull();
      expect(reproduction?.history.map((pregnancy) => pregnancy.outcome)).toEqual([
        'CALVED',
        'CALVED',
        'CALVED',
      ]);
    });

    it('parto vencido sin registrar: en la ficha y con su filtro en el listado', async () => {
      // 12/11/2025 + 293 = 01/09/2026: 24 días vencido, más de los 15 de la finca.
      const { id } = (await serve(cow, { serviceDate: '2025-11-12' }).expect(201))
        .body as PregnancyView;
      await http()
        .post(`/api/v1/pregnancies/${id}/diagnosis`)
        .set(vet)
        .send({ date: '2026-02-20', result: 'POSITIVE' })
        .expect(201);
      const cowDetail = await detail(cow);
      expect(cowDetail.alerts).toEqual(['calving_soon', 'calving_overdue']);
      const list = await http()
        .get('/api/v1/animals?alerts=calving_overdue')
        .set(operator)
        .expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([cow]);

      // El umbral sale de la configuración: con 30 días ya no alerta.
      await prisma.farm.update({
        where: { id: esperanza.farmId },
        data: { settings: { ...DEFAULT_FARM_SETTINGS, overdueCalvingAlertDays: 30 } },
      });
      expect((await detail(cow)).alerts).toEqual(['calving_soon']);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('Recálculo del parto estimado (RN-04, M5)', () => {
    it('la gestación de la finca recalcula las preñeces de razas sin gestación propia', async () => {
      await prisma.breed.update({
        where: { id: esperanza.breedId },
        data: { gestationDays: null },
      });
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      expect((await pregnancyRow(id)).expectedCalvingDate.toISOString().slice(0, 10)).toBe(
        '2026-10-24',
      );
      const farm = await http().get('/api/v1/farm').set(admin).expect(200);
      const response = await http()
        .patch('/api/v1/farm')
        .set(admin)
        .send({ version: farm.body.version, settings: { gestationDays: 290 } })
        .expect(200);
      expect(response.body.warnings[0].code).toBe('EXPECTED_CALVING_RECALCULATED');
      expect((await pregnancyRow(id)).expectedCalvingDate.toISOString().slice(0, 10)).toBe(
        '2026-10-29',
      );
    });

    it('cambiar la raza de la madre recalcula su preñez abierta', async () => {
      const taurus = uuidv7();
      await prisma.breed.create({
        data: {
          id: taurus,
          farmId: esperanza.farmId,
          name: 'Holstein',
          group: 'TAURUS',
          gestationDays: 283,
        },
      });
      const { id } = (await serve(cow).expect(201)).body as PregnancyView;
      const current = await detail(cow);
      const response = await http()
        .patch(`/api/v1/animals/${cow}`)
        .set(operator)
        .send({ version: current.version, breedId: taurus })
        .expect(200);
      expect(response.body.warnings.map((warning: { code: string }) => warning.code)).toEqual([
        'EXPECTED_CALVING_RECALCULATED',
      ]);
      expect((await pregnancyRow(id)).expectedCalvingDate.toISOString().slice(0, 10)).toBe(
        '2026-10-22',
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('GET /pregnancies y GET /reports/births (NAC-01)', () => {
    it('listado por hembra y desenlace; otra finca no ve nada', async () => {
      await serve(cow).expect(201);
      for (const headers of [admin, operator, vet]) {
        const response = await http()
          .get(`/api/v1/pregnancies?damId=${cow}&outcome=PENDING`)
          .set(headers)
          .expect(200);
        expect(response.body.items).toHaveLength(1);
      }
      const other = await http().get('/api/v1/pregnancies').set(otherAdmin).expect(200);
      expect(other.body.items).toEqual([]);
    });

    it('nacimientos del período: totales por sexo, débiles y muertos al nacer, y el detalle', async () => {
      await serve(cow, { sireId: bull }).expect(201);
      await calve({
        calves: [
          { sex: 'FEMALE', health: 'ALIVE', birthWeightKg: 30 },
          { sex: 'MALE', health: 'WEAK' },
          { sex: 'MALE', health: 'STILLBORN' },
        ],
      }).expect(201);
      for (const headers of [admin, operator, vet]) {
        const report = (
          await http()
            .get('/api/v1/reports/births?from=2026-01-01&to=2026-12-31')
            .set(headers)
            .expect(200)
        ).body as BirthsReport;
        expect(report.totals).toEqual({ live: 2, males: 1, females: 1, weak: 1, stillborn: 1 });
        expect(report.items.find((item) => item.calf.sex === 'FEMALE')).toMatchObject({
          birthDate: '2026-09-20',
          dam: { id: cow, code: '087' },
          sire: { id: bull },
          breed: 'Brahman',
          birthWeightKg: 30,
          birthCondition: 'HEALTHY',
        });
        expect(report.stillbirths).toEqual([
          expect.objectContaining({ date: '2026-09-20', count: 1 }),
        ]);
      }
      const other = (await http().get('/api/v1/reports/births').set(otherAdmin).expect(200))
        .body as BirthsReport;
      expect(other.totals.live).toBe(0);
    });
  });
});
