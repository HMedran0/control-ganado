import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE, uuidv7, type AuditEntryView, type AuditPage, type Role } from '@hato/shared';
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

/**
 * `GET /audit` con los eventos de M5 y M6 (ajuste previo de M7): preñeces y partos,
 * vacunaciones, tratamientos, pesajes, perfiles de báscula e importaciones, nombrados en
 * lenguaje de finca. Sigue siendo solo del ADMIN y sin montos.
 */
describe('GET /audit con los eventos de M5 y M6', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let aftosa: string;
  let cow: string;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role): Promise<Record<string, string>> => {
    const { userId } = await createMember(prisma, farm, role);
    return bearer(await signTestToken(app, { userId, farmId: farm.farmId }));
  };

  const auditOf = async (query: Record<string, string>): Promise<readonly AuditEntryView[]> =>
    ((await http().get('/api/v1/audit').query(query).set(admin).expect(200)).body as AuditPage)
      .items;

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
    aftosa = uuidv7();
    await prisma.vaccine.create({
      data: {
        id: aftosa,
        farmId: esperanza.farmId,
        name: 'Aftosa',
        disease: 'Aftosa',
        defaultDose: '2 ml',
        scheduleType: 'NONE',
      },
    });
    cow = await createAnimal(prisma, esperanza, { code: '087' });
  });

  it('la pestaña Cambios del animal trae sus eventos, con nombre, fecha, animal y motivo', async () => {
    const vaccination = await http()
      .post('/api/v1/vaccinations')
      .set(operator)
      .send({ animalId: cow, vaccineId: aftosa, date: '2026-05-12' })
      .expect(201);
    await http()
      .post(`/api/v1/vaccinations/${vaccination.body.id as string}/void`)
      .set(vet)
      .send({ reason: 'Era otra vaca' })
      .expect(201);
    await http()
      .post('/api/v1/treatments')
      .set(admin)
      .send({
        animalId: cow,
        startedOn: '2026-09-20',
        reason: 'Mastitis',
        medication: 'Oxitetraciclina',
        durationDays: 3,
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 7,
        cost: '85000',
      })
      .expect(201);
    await http()
      .post('/api/v1/weights')
      .set(operator)
      .send({ animalId: cow, date: '2026-09-21', weightKg: 320.5, method: 'TAPE' })
      .expect(201);
    await http()
      .post('/api/v1/pregnancies')
      .set(vet)
      .send({ damId: cow, serviceDate: '2026-08-01', method: 'NATURAL' })
      .expect(201);
    // Eventos de otro animal: no aparecen en la ficha de esta vaca.
    const other = await createAnimal(prisma, esperanza, { code: '140' });
    await http()
      .post('/api/v1/weights')
      .set(operator)
      .send({ animalId: other, date: '2026-09-21', weightKg: 280, method: 'TAPE' })
      .expect(201);

    const items = await auditOf({ animalId: cow });
    expect(items.map((item) => [item.entity, item.action])).toEqual([
      ['Pregnancy', 'CREATE'],
      ['WeightRecord', 'CREATE'],
      ['TreatmentRecord', 'CREATE'],
      ['VaccinationRecord', 'VOID'],
      ['VaccinationRecord', 'CREATE'],
    ]);
    const voided = items.find((item) => item.action === 'VOID');
    expect(voided).toMatchObject({
      entityLabel: 'Aftosa',
      entityDate: '2026-05-12',
      animalCode: '087',
    });
    expect(voided?.changes).toContainEqual({
      field: 'reason',
      before: null,
      after: 'Era otra vaca',
    });
    expect(voided?.user?.name).not.toBe('');

    const created = items.find(
      (item) => item.entity === 'VaccinationRecord' && item.action === 'CREATE',
    );
    // El id de la vacuna llega como su nombre.
    expect(created?.changes).toContainEqual({ field: 'vaccineId', before: null, after: 'Aftosa' });

    expect(items.find((item) => item.entity === 'WeightRecord')).toMatchObject({
      entityLabel: '320.5',
      entityDate: '2026-09-21',
    });
    expect(items.find((item) => item.entity === 'TreatmentRecord')).toMatchObject({
      entityLabel: 'Oxitetraciclina',
      entityDate: '2026-09-20',
    });
    const pregnancy = items.find((item) => item.entity === 'Pregnancy');
    expect(pregnancy).toMatchObject({
      entityLabel: null,
      entityDate: '2026-08-01',
      animalCode: '087',
    });
    // La madre de la preñez es el mismo animal: no se repite como cambio.
    expect(pregnancy?.changes.map((change) => change.field)).not.toContain('damId');

    // RN-20: ni el costo del tratamiento ni su gasto salen por aquí.
    const body = JSON.stringify(items);
    expect(body).not.toContain('85000');
    expect(body).not.toMatch(/"(cost|amount)"/);
  });

  it('perfiles de báscula e importaciones se consultan por entidad', async () => {
    const profile = await http()
      .post('/api/v1/scale-profiles/tru-test/duplicate')
      .set(admin)
      .send({ name: 'Báscula del corral' })
      .expect(201);
    const items = await auditOf({ entity: 'ScaleProfile' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: 'CREATE',
      entityId: profile.body.id as string,
      entityLabel: 'Báscula del corral',
      entityDate: null,
      animalCode: null,
    });

    const batchId = uuidv7();
    await prisma.importBatch.create({
      data: {
        id: batchId,
        farmId: esperanza.farmId,
        idempotencyKey: uuidv7(),
        fileSha256: 'a'.repeat(64),
        kind: 'WEIGHTS',
        fileName: 'pesaje-septiembre.csv',
        totalRows: 1,
        createdRows: 1,
        errorRows: 0,
        summary: {},
        createdById: esperanza.userId,
      },
    });
    await prisma.auditLog.create({
      data: {
        farmId: esperanza.farmId,
        userId: esperanza.userId,
        entity: 'ImportBatch',
        entityId: batchId,
        action: 'IMPORT',
        diff: { after: { kind: 'WEIGHTS', fileName: 'pesaje-septiembre.csv', created: 1 } },
      },
    });
    const imports = await auditOf({ entity: 'ImportBatch', entityId: batchId });
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ action: 'IMPORT', entityLabel: 'pesaje-septiembre.csv' });
  });

  it('OPERATOR y VET reciben 403; otra finca no ve los eventos ni el animal', async () => {
    await http()
      .post('/api/v1/weights')
      .set(operator)
      .send({ animalId: cow, date: '2026-09-21', weightKg: 300, method: 'TAPE' })
      .expect(201);
    for (const headers of [operator, vet]) {
      await http().get('/api/v1/audit').query({ entity: 'WeightRecord' }).set(headers).expect(403);
    }
    await http().get('/api/v1/audit').query({ animalId: cow }).set(otherAdmin).expect(404);
    const foreign = (
      await http()
        .get('/api/v1/audit')
        .query({ entity: 'WeightRecord' })
        .set(otherAdmin)
        .expect(200)
    ).body as AuditPage;
    expect(foreign.items).toEqual([]);
  });
});
