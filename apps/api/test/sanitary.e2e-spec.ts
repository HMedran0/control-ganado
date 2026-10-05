import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ROLE,
  toIsoDate,
  uuidv7,
  type AnimalDetail,
  type BulkVaccinationResult,
  type CycleProgressView,
  type Role,
  type TreatmentList,
  type TreatmentView,
  type VaccinationList,
  type VaccinationWithWarnings,
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
 * Sanidad (M6: SAN-02 a SAN-06, RN-12, RN-13, RN-14, RN-20, RN-22, RN-26) contra PostgreSQL real.
 * Cada endpoint con los roles autorizados, el no autorizado cuando lo hay y un usuario de otra
 * finca. «Hoy» es el 25/09/2026; hay un ciclo oficial en curso (01/09 a 31/10) con aftosa.
 */
describe('Sanidad', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let aftosa: string;
  let brucelosis: string;
  let clostridial: string;
  let cycleId: string;
  let cow: string;
  let calf: string;
  let bull: string;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  const vaccinate = (body: Record<string, unknown>, headers = operator) =>
    http()
      .post('/api/v1/vaccinations')
      .set(headers)
      .send({ animalId: cow, vaccineId: aftosa, date: '2026-09-20', ...body });

  const detail = async (id: string) =>
    (await http().get(`/api/v1/animals/${id}`).set(admin).expect(200)).body as AnimalDetail;

  const vaccineOf = (animal: AnimalDetail, vaccineId: string) =>
    animal.vaccines.find((vaccine) => vaccine.vaccineId === vaccineId);

  const createVaccine = async (data: {
    name: string;
    scheduleType: 'OFFICIAL_CYCLE' | 'AGE_WINDOW' | 'INTERVAL';
    boosterIntervalDays?: number;
    eligibleSex?: 'FEMALE' | 'MALE';
    minAgeDays?: number;
    maxAgeDays?: number;
    blockIneligibleSex?: boolean;
  }): Promise<string> => {
    const id = uuidv7();
    await prisma.vaccine.create({
      data: { id, farmId: esperanza.farmId, disease: data.name, defaultDose: '2 ml', ...data },
    });
    return id;
  };

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

    aftosa = await createVaccine({ name: 'Aftosa', scheduleType: 'OFFICIAL_CYCLE' });
    brucelosis = await createVaccine({
      name: 'Brucelosis RB51',
      scheduleType: 'AGE_WINDOW',
      eligibleSex: 'FEMALE',
      minAgeDays: 90,
      maxAgeDays: 270,
      blockIneligibleSex: true,
    });
    clostridial = await createVaccine({
      name: 'Clostridial',
      scheduleType: 'INTERVAL',
      boosterIntervalDays: 365,
      minAgeDays: 90,
    });
    cycleId = uuidv7();
    await prisma.vaccinationCycle.create({
      data: {
        id: cycleId,
        farmId: esperanza.farmId,
        name: '2026-X',
        startsOn: toPrismaDate(toIsoDate('2026-09-01')),
        endsOn: toPrismaDate(toIsoDate('2026-10-31')),
      },
    });
    await prisma.vaccinationCycleVaccine.create({
      data: { id: uuidv7(), farmId: esperanza.farmId, cycleId, vaccineId: aftosa },
    });

    cow = await createAnimal(prisma, esperanza, {
      code: '087',
      birthDate: toIsoDate('2019-03-12'),
    });
    calf = await createAnimal(prisma, esperanza, {
      code: '26-010',
      birthDate: toIsoDate('2026-05-01'),
    });
    bull = await createAnimal(prisma, esperanza, {
      code: 'T-1',
      sex: 'MALE',
      birthDate: toIsoDate('2018-01-01'),
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /vaccinations (SAN-02)', () => {
    it.each([
      ['ADMIN', () => admin],
      ['OPERATOR', () => operator],
      ['VET', () => vet],
    ])(
      '%s registra; la de ciclo queda en el ciclo y resuelve la alerta',
      async (_role, headers) => {
        expect(vaccineOf(await detail(cow), aftosa)).toMatchObject({ status: 'PENDING' });
        const response = await vaccinate({ ruvNumber: 'RUV-123' }, headers()).expect(201);
        expect(response.body).toMatchObject({
          appliedOn: '2026-09-20',
          dose: '2 ml',
          ruvNumber: 'RUV-123',
          cycle: { id: cycleId, name: '2026-X' },
          nextDueOn: null,
          warnings: [],
        });
        expect(vaccineOf(await detail(cow), aftosa)).toMatchObject({ status: 'UP_TO_DATE' });
      },
    );

    it('RN-12: la de intervalo propone la próxima fecha; se puede cambiar o dejar vacía', async () => {
      const proposed = await vaccinate({ vaccineId: clostridial }).expect(201);
      expect(proposed.body.nextDueOn).toBe('2027-09-20');
      const edited = await vaccinate({
        vaccineId: clostridial,
        animalId: bull,
        nextDueOn: '2027-03-01',
      }).expect(201);
      expect(edited.body.nextDueOn).toBe('2027-03-01');
      const none = await vaccinate({ vaccineId: clostridial, animalId: calf, nextDueOn: null });
      expect(none.status).toBe(201);
      expect(none.body.nextDueOn).toBeNull();

      const wrong = await vaccinate({ nextDueOn: '2027-01-01' }).expect(422);
      expect(wrong.body.errors).toHaveProperty('nextDueOn');
      const before = await vaccinate({ vaccineId: clostridial, nextDueOn: '2026-09-01' });
      expect(before.status).toBe(422);
    });

    it('RN-26: brucelosis en un macho se rechaza; fuera de edad solo advierte', async () => {
      const blocked = await vaccinate({ vaccineId: brucelosis, animalId: bull }).expect(422);
      expect(blocked.body).toMatchObject({
        code: 'VACCINE_SEX_BLOCKED',
        detail: 'La vacuna Brucelosis RB51 no se aplica a machos.',
      });
      const old = await vaccinate({ vaccineId: brucelosis }).expect(201);
      expect((old.body as VaccinationWithWarnings).warnings[0]?.code).toBe(
        'VACCINE_AGE_OUTSIDE_WINDOW',
      );
    });

    it('RN-14 y RN-09: fecha futura, anterior al nacimiento, animal que salió', async () => {
      expect((await vaccinate({ date: '2026-09-26' }).expect(422)).body.code).toBe(
        'DATE_IN_FUTURE',
      );
      expect((await vaccinate({ animalId: calf, date: '2026-04-30' }).expect(422)).body.code).toBe(
        'DATE_BEFORE_BIRTH',
      );
      await prisma.animal.update({
        where: { id: bull },
        data: { exitType: 'DEATH', exitDate: toPrismaDate(toIsoDate('2026-09-01')) },
      });
      expect((await vaccinate({ animalId: bull }).expect(409)).body.code).toBe('ANIMAL_EXITED');
    });

    it('otra finca: su animal o su vacuna no existen aquí, y no ve las vacunaciones', async () => {
      await vaccinate({}).expect(201);
      const foreign = await vaccinate({}, otherAdmin).expect(422);
      expect(foreign.body.errors).toHaveProperty('animalId');
      const list = await http()
        .get(`/api/v1/vaccinations?animalId=${cow}`)
        .set(otherAdmin)
        .expect(200);
      expect((list.body as VaccinationList).items).toEqual([]);
      const own = await http().get(`/api/v1/vaccinations?animalId=${cow}`).set(vet).expect(200);
      expect((own.body as VaccinationList).items).toHaveLength(1);
    });

    it('ADR-012: el mismo id con el mismo contenido → 200; con otro → CLIENT_ID_CONFLICT', async () => {
      const id = uuidv7();
      await vaccinate({ id }).expect(201);
      await vaccinate({ id }).expect(200);
      expect((await vaccinate({ id, dose: '5 ml' }).expect(409)).body.code).toBe(
        'CLIENT_ID_CONFLICT',
      );
      expect((await vaccinate({ id }, otherAdmin).expect(409)).body.code).toBe(
        'CLIENT_ID_CONFLICT',
      );
      expect(await prisma.vaccinationRecord.count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /vaccinations/bulk (SAN-03)', () => {
    const bulk = (body: Record<string, unknown>, headers = operator, query = '') =>
      http()
        .post(`/api/v1/vaccinations/bulk${query}`)
        .set(headers)
        .send({ vaccineId: aftosa, date: '2026-09-25', ...body });

    it('simula y luego registra en una transacción, omitiendo y listando a los que no aplican', async () => {
      await vaccinate({ animalId: calf }).expect(201); // ya la tiene en el ciclo
      const bought = await createAnimal(prisma, esperanza, {
        code: '300',
        birthDate: toIsoDate('2022-01-01'),
        entryDate: toIsoDate('2026-09-26'),
      });
      const ids = [cow, calf, bull, bought];

      const plan = await bulk({ animalIds: ids }, operator, '?dryRun=true').expect(201);
      const result = plan.body as BulkVaccinationResult;
      expect(result).toMatchObject({ dryRun: true, selected: 4, created: 0 });
      expect(result.toApply.map((animal) => animal.code)).toEqual(['087', 'T-1']);
      expect(result.skipped.map((item) => [item.animal.code, item.reason])).toEqual([
        ['26-010', 'ALREADY_IN_CYCLE'],
        ['300', 'BEFORE_BIRTH_OR_ENTRY'],
      ]);
      expect(await prisma.vaccinationRecord.count()).toBe(1);

      const key = uuidv7();
      const done = await bulk({ animalIds: ids }, operator).set('Idempotency-Key', key);
      expect(done.status).toBe(201);
      expect(done.body).toMatchObject({ dryRun: false, created: 2, cycle: { id: cycleId } });
      expect(await prisma.vaccinationRecord.count({ where: { cycleId } })).toBe(3);

      // Un reintento con la misma clave devuelve lo mismo y no duplica.
      const again = await bulk({ animalIds: ids }, operator).set('Idempotency-Key', key);
      expect(again.status).toBe(201);
      expect(again.body).toEqual(done.body);
      expect(await prisma.vaccinationRecord.count()).toBe(3);
      expect(
        await prisma.auditLog.count({ where: { entity: 'VaccinationRecord', action: 'CREATE' } }),
      ).toBe(3);
    });

    it('brucelosis por lote: omite los machos (RN-26) y advierte la edad', async () => {
      const result = (
        await bulk({ vaccineId: brucelosis, animalIds: [cow, calf, bull] }, vet).expect(201)
      ).body as BulkVaccinationResult;
      expect(result.created).toBe(2);
      expect(result.skipped).toEqual([
        { animal: { id: bull, code: 'T-1', name: null }, reason: 'SEX_BLOCKED' },
      ]);
      expect(result.warnings.map((item) => item.animal.code)).toEqual(['087']);
    });

    it('con los filtros del listado y excluyendo animales (CA1 y CA3)', async () => {
      const result = (
        await bulk({ filter: { sex: 'FEMALE' }, excludeIds: [calf] }, admin, '?dryRun=true').expect(
          201,
        )
      ).body as BulkVaccinationResult;
      expect(result.toApply.map((animal) => animal.code)).toEqual(['087']);
    });

    it('otra finca: sus ids no existen aquí (404) y nada se guarda', async () => {
      await bulk({ animalIds: [cow] }, otherAdmin).expect(404);
      expect(await prisma.vaccinationRecord.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /vaccinations/:id/void', () => {
    it('ADMIN y VET anulan; OPERATOR no; otra finca 404; anular dos veces responde 200', async () => {
      const { id } = (await vaccinate({}).expect(201)).body as VaccinationWithWarnings;
      const voidIt = (headers: Record<string, string>) =>
        http().post(`/api/v1/vaccinations/${id}/void`).set(headers).send({ reason: 'Otra vaca' });

      expect((await voidIt(operator).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      await voidIt(otherAdmin).expect(404);
      const voided = await voidIt(vet).expect(201);
      expect(voided.body.voided).toMatchObject({ reason: 'Otra vaca' });
      await voidIt(admin).expect(200);
      // La anulada no cuenta: vuelve a estar pendiente (RN-13).
      expect(vaccineOf(await detail(cow), aftosa)).toMatchObject({ status: 'PENDING' });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('GET /vaccination-cycles/:id/progress (SAN-06 CA2)', () => {
    it('cuenta vacunados y pendientes entre los que podían vacunarse (ADR-004)', async () => {
      await vaccinate({}).expect(201);
      // Ingresó después del cierre: no cuenta en el denominador.
      await createAnimal(prisma, esperanza, {
        code: '301',
        birthDate: toIsoDate('2022-01-01'),
        entryDate: toIsoDate('2026-11-05'),
      });
      const progress = (
        await http().get(`/api/v1/vaccination-cycles/${cycleId}/progress`).set(operator).expect(200)
      ).body as CycleProgressView;
      expect(progress).toMatchObject({
        state: 'CURRENT',
        vaccines: [{ vaccineId: aftosa, name: 'Aftosa', eligible: 3, vaccinated: 1, pending: 2 }],
      });
      await http()
        .get(`/api/v1/vaccination-cycles/${cycleId}/progress`)
        .set(otherAdmin)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('tratamientos (SAN-05, RN-22)', () => {
    const treat = (body: Record<string, unknown>, headers = vet) =>
      http()
        .post('/api/v1/treatments')
        .set(headers)
        .send({
          animalId: cow,
          startedOn: '2026-09-20',
          reason: 'Mastitis',
          medication: 'Oxitetraciclina',
          durationDays: 3,
          withdrawalMeatDays: 28,
          withdrawalMilkDays: 7,
          ...body,
        });

    it.each([
      ['ADMIN', () => admin],
      ['OPERATOR', () => operator],
      ['VET', () => vet],
    ])('%s registra; la ficha muestra los dos retiros y «En retiro»', async (_role, headers) => {
      const created = await treat({}, headers()).expect(201);
      expect(created.body).toMatchObject({
        meatWithdrawalUntil: '2026-10-21',
        milkWithdrawalUntil: '2026-09-30',
        withdrawalUntil: '2026-10-21',
      });
      const animal = await detail(cow);
      expect(animal.withdrawals).toEqual({ meatUntil: '2026-10-21', milkUntil: '2026-09-30' });
      expect(animal.derivedTags).toContain('WITHDRAWAL');
      expect(animal.alerts).toContain('withdrawal');
      const list = await http().get('/api/v1/animals?alerts=withdrawal').set(operator).expect(200);
      expect(list.body.items.map((item: { code: string }) => item.code)).toEqual(['087']);
    });

    it('RN-22: vender en retiro de carne exige confirmar; solo de leche, no', async () => {
      await treat({}).expect(201);
      const blocked = await http()
        .post(`/api/v1/animals/${cow}/exit`)
        .set(admin)
        .send({ type: 'SALE', date: '2026-09-25', sale: { amount: '2500000' } })
        .expect(409);
      expect(blocked.body).toMatchObject({
        code: 'WITHDRAWAL_ACTIVE',
        detail: 'El animal está en retiro hasta 21/10/2026. Confirma para continuar.',
      });

      await treat({ animalId: bull, withdrawalMeatDays: 0, withdrawalMilkDays: 10 }).expect(201);
      await http()
        .post(`/api/v1/animals/${bull}/exit`)
        .set(admin)
        .send({ type: 'SALE', date: '2026-09-25', sale: { amount: '3000000' } })
        .expect(201);
    });

    it('RN-20: el costo solo lo registra y lo ve ADMIN; crea un gasto directo', async () => {
      const denied = await treat({ cost: '85000' }, operator).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN_ROLE');
      const created = (await treat({ cost: '85000' }, admin).expect(201)).body as TreatmentView;
      expect(created.cost).toBe('85000.00');
      const expense = await prisma.expense.findFirstOrThrow({
        where: { farmId: esperanza.farmId, type: 'MEDICATION' },
        include: { allocations: true },
      });
      expect(expense.amount.toFixed(2)).toBe('85000.00');
      expect(expense.allocations.map((item) => item.animalId)).toEqual([cow]);

      const asVet = (await http().get(`/api/v1/treatments?animalId=${cow}`).set(vet).expect(200))
        .body as TreatmentList;
      expect(asVet.items[0]).not.toHaveProperty('cost');
      const asAdmin = (
        await http().get(`/api/v1/treatments?animalId=${cow}`).set(admin).expect(200)
      ).body as TreatmentList;
      expect(asAdmin.items[0]?.cost).toBe('85000.00');
    });

    it('anular: ADMIN y VET; OPERATOR no; otra finca 404; anula también el gasto y el retiro', async () => {
      const { id } = (await treat({ cost: '85000' }, admin).expect(201)).body as TreatmentView;
      const voidIt = (headers: Record<string, string>) =>
        http().post(`/api/v1/treatments/${id}/void`).set(headers).send({ reason: 'Duplicado' });
      await voidIt(operator).expect(403);
      await voidIt(otherAdmin).expect(404);
      await voidIt(vet).expect(201);
      await voidIt(admin).expect(200);
      const expense = await prisma.expense.findFirstOrThrow({ where: { type: 'MEDICATION' } });
      expect(expense.voidedAt).not.toBeNull();
      const animal = await detail(cow);
      expect(animal.alerts).not.toContain('withdrawal');
      expect(animal.withdrawals).toEqual({ meatUntil: null, milkUntil: null });
    });

    it('otra finca no puede tratar sus animales ni ver sus tratamientos', async () => {
      await treat({}).expect(201);
      expect((await treat({}, otherAdmin).expect(422)).body.errors).toHaveProperty('animalId');
      const list = await http().get('/api/v1/treatments').set(otherAdmin).expect(200);
      expect((list.body as TreatmentList).items).toEqual([]);
    });
  });
});
