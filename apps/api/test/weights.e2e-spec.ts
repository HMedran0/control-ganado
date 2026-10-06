import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ROLE,
  toIsoDate,
  uuidv7,
  type AnimalWeights,
  type Role,
  type ScaleProfileList,
  type ScaleProfileView,
  type WeightImportDryRun,
  type WeightImportResult,
  type WeightWithWarnings,
} from '@hato/shared';
import request from 'supertest';

import { toPrismaDate } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { TableStatsService } from '../src/infra/table-stats.service.js';
import { bearer, createTestAppWithClock, signTestToken, type FakeClock } from './helpers/app.js';
import { lastAnalyzed } from './helpers/table-stats.js';
import {
  cleanDatabase,
  createAnimal,
  createFarm,
  createMember,
  type TestFarm,
} from './helpers/fixtures.js';

/**
 * Pesos y báscula (M6: PES-01, PES-02, PES-04, PES-05) contra PostgreSQL real. Cada endpoint con
 * los roles autorizados, el no autorizado cuando lo hay y un usuario de otra finca. «Hoy» es el
 * 25/09/2026.
 *
 * La importación usa un CSV **sintético** con el formato provisional de la plantilla Tru-Test
 * (`EID,VID,Weight,Date,Time`, fecha dd/mm/aaaa, kilos): las columnas reales se confirman con un
 * archivo de la finca piloto (05-api.md, PES-04).
 */

const CHIP_COW = '982000000000001';
const CHIP_STEER = '982000000000002';
const CHIP_UNKNOWN = '982000000000999';

/** Archivo sintético de la báscula con el formato de la plantilla Tru-Test. */
function truTestCsv(lines: readonly string[]): { data: Buffer; fileName: string } {
  const text = ['EID,VID,Weight,Date,Time', ...lines].join('\r\n');
  return { data: Buffer.from(`${text}\r\n`, 'utf8'), fileName: 'sesion-xr5000.csv' };
}

describe('Pesos y báscula', () => {
  let app: NestFastifyApplication;
  let clock: FakeClock;
  let prisma: PrismaService;
  let esperanza: TestFarm;
  let palmar: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let operatorId: string;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;
  let cow: string;
  let steer: string;
  let heifer: string;

  const http = () => request(app.getHttpServer());

  const as = async (farm: TestFarm, role: Role) => {
    const { userId } = await createMember(prisma, farm, role);
    return { userId, headers: bearer(await signTestToken(app, { userId, farmId: farm.farmId })) };
  };

  const weigh = (body: Record<string, unknown>, headers = operator) =>
    http()
      .post('/api/v1/weights')
      .set(headers)
      .send({ animalId: steer, date: '2026-09-20', weightKg: 320, method: 'TAPE', ...body });

  const upload = (
    file: { data: Buffer; fileName: string },
    headers: Record<string, string>,
    fields: Record<string, string> = {},
    dryRun = true,
  ) => {
    let call = http()
      .post(`/api/v1/weights/import${dryRun ? '?dryRun=true' : ''}`)
      .set(headers);
    for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
    return call.attach('file', file.data, { filename: file.fileName, contentType: 'text/csv' });
  };

  const addIdentifier = async (animalId: string, type: 'RFID' | 'VISUAL_TAG', value: string) => {
    await prisma.identifier.create({
      data: {
        id: uuidv7(),
        farmId: esperanza.farmId,
        animalId,
        type,
        value,
        assignedAt: toPrismaDate(toIsoDate('2025-01-01')),
      },
    });
  };

  beforeAll(async () => {
    ({ app, clock } = await createTestAppWithClock());
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
    const op = await as(esperanza, ROLE.OPERATOR);
    operator = op.headers;
    operatorId = op.userId;
    vet = (await as(esperanza, ROLE.VET)).headers;

    cow = await createAnimal(prisma, esperanza, {
      code: '087',
      birthDate: toIsoDate('2019-03-12'),
    });
    steer = await createAnimal(prisma, esperanza, {
      code: '045',
      sex: 'MALE',
      birthDate: toIsoDate('2025-06-01'),
    });
    heifer = await createAnimal(prisma, esperanza, {
      code: '26-010',
      birthDate: toIsoDate('2025-08-01'),
    });
    await addIdentifier(cow, 'RFID', CHIP_COW);
    await addIdentifier(steer, 'RFID', CHIP_STEER);
    await addIdentifier(heifer, 'VISUAL_TAG', '26-010');
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /weights (PES-01)', () => {
    it.each([
      ['ADMIN', () => admin],
      ['OPERATOR', () => operator],
      ['VET', () => vet],
    ])('%s registra el peso digitado con cómo identificó al animal', async (_role, headers) => {
      const response = await weigh({ identifiedBy: 'RFID_READER' }, headers()).expect(201);
      expect(response.body).toMatchObject({
        weighedOn: '2026-09-20',
        weightKg: 320,
        method: 'TAPE',
        identifiedBy: 'RFID_READER',
        weightSource: 'MANUAL',
        warnings: [],
      });
    });

    it('sin indicarlo, la identificación es por búsqueda', async () => {
      expect((await weigh({}).expect(201)).body.identifiedBy).toBe('SEARCH');
    });

    it('CA2: avisa del peso atípico (más del 30 %) sin bloquear', async () => {
      await weigh({ date: '2026-06-15', weightKg: 250 }).expect(201);
      const normal = await weigh({ date: '2026-07-15', weightKg: 325 }).expect(201);
      expect((normal.body as WeightWithWarnings).warnings).toEqual([]);
      const outlier = await weigh({ weightKg: 500 }).expect(201);
      expect((outlier.body as WeightWithWarnings).warnings).toEqual([
        {
          code: 'WEIGHT_OUTLIER',
          message: 'El peso 500 kg se aleja mucho del último registrado. Verifícalo.',
        },
      ]);
    });

    it('RN-14 y otra finca', async () => {
      expect((await weigh({ date: '2026-09-26' }).expect(422)).body.code).toBe('DATE_IN_FUTURE');
      expect((await weigh({ date: '2025-05-01' }).expect(422)).body.code).toBe('DATE_BEFORE_BIRTH');
      expect((await weigh({}, otherAdmin).expect(422)).body.errors).toHaveProperty('animalId');
    });

    it('ADR-012: el mismo id con el mismo contenido → 200; con otro → CLIENT_ID_CONFLICT', async () => {
      const id = uuidv7();
      await weigh({ id }).expect(201);
      await weigh({ id }).expect(200);
      expect((await weigh({ id, weightKg: 321 }).expect(409)).body.code).toBe('CLIENT_ID_CONFLICT');
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /weights/:id/void', () => {
    it('quien lo registró, en 24 horas; después, solo ADMIN; otra finca 404', async () => {
      const { id } = (await weigh({}, operator).expect(201)).body as WeightWithWarnings;
      const voidIt = (headers: Record<string, string>) =>
        http().post(`/api/v1/weights/${id}/void`).set(headers).send({ reason: 'Mal digitado' });

      await voidIt(otherAdmin).expect(404);
      expect((await voidIt(vet).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      // Registrado hace 25 horas: ya no es del operario anular.
      await prisma.weightRecord.update({
        where: { id },
        data: { createdAt: new Date(clock.now().getTime() - 25 * 60 * 60 * 1000) },
      });
      expect((await voidIt(operator).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      await voidIt(admin).expect(201);
      await voidIt(admin).expect(200);

      const own = (await weigh({ date: '2026-09-21' }, operator).expect(201))
        .body as WeightWithWarnings;
      await http()
        .post(`/api/v1/weights/${own.id}/void`)
        .set(operator)
        .send({ reason: 'Repetido' })
        .expect(201);
      expect(own.createdById).toBe(operatorId);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('GET /animals/:id/weights (PES-02, PES-05)', () => {
    it('serie en orden y ganancias, con la alerta de ganancia baja del levante', async () => {
      await weigh({ date: '2026-06-15', weightKg: 300 }).expect(201);
      await weigh({ date: '2026-09-15', weightKg: 320 }).expect(201);
      const body = (await http().get(`/api/v1/animals/${steer}/weights`).set(vet).expect(200))
        .body as AnimalWeights;
      expect(body.items.map((item) => item.weighedOn)).toEqual(['2026-06-15', '2026-09-15']);
      // 20 kg en 92 días = 0,217 kg/día: menos que 0,30 en Levante (PES-05 CA2).
      expect(body.summary).toMatchObject({
        gains: { lastTwo: 0.217, last90Days: 0.217, sinceBirth: null },
        gainThreshold: 0.3,
        lowGain: true,
        weightLoss: false,
      });
      const list = await http().get('/api/v1/animals?alerts=low_gain').set(operator).expect(200);
      expect(list.body.items.map((item: { code: string }) => item.code)).toEqual(['045']);
    });

    it('perdió peso (PES-05 CA3) y otra finca no ve la serie', async () => {
      await weigh({ animalId: cow, date: '2026-06-15', weightKg: 450 }).expect(201);
      await weigh({ animalId: cow, date: '2026-09-15', weightKg: 420 }).expect(201);
      const body = (await http().get(`/api/v1/animals/${cow}/weights`).set(admin).expect(200))
        .body as AnimalWeights;
      expect(body.summary).toMatchObject({ weightLoss: true, lossPercent: 6.7 });
      const list = await http().get('/api/v1/animals?alerts=weight_loss').set(admin).expect(200);
      expect(list.body.items.map((item: { code: string }) => item.code)).toEqual(['087']);
      await http().get(`/api/v1/animals/${cow}/weights`).set(otherAdmin).expect(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('perfiles de báscula (PES-04 CA1)', () => {
    const mapping = {
      eid: ['Chip'],
      visualId: ['Número'],
      weight: ['Peso (lb)'],
      date: ['Fecha'],
      time: [],
      dateFormat: 'DMY',
      unit: 'LB',
    };

    it('todos ven la plantilla Tru-Test (provisional); solo ADMIN crea, edita y duplica', async () => {
      const list = (await http().get('/api/v1/scale-profiles').set(operator).expect(200))
        .body as ScaleProfileList;
      expect(list.items).toEqual([
        expect.objectContaining({ id: 'tru-test', system: true, provisional: true, unit: 'KG' }),
      ]);

      const body = { name: 'Báscula del corral', fileFormat: 'CSV', columnMapping: mapping };
      await http().post('/api/v1/scale-profiles').set(operator).send(body).expect(403);
      const created = (
        await http().post('/api/v1/scale-profiles').set(admin).send(body).expect(201)
      ).body as ScaleProfileView;
      expect(created).toMatchObject({ system: false, unit: 'LB', version: 1 });
      const taken = await http()
        .post('/api/v1/scale-profiles')
        .set(admin)
        .send({ ...body, name: 'báscula del corral ' })
        .expect(409);
      expect(taken.body.code).toBe('CATALOG_NAME_TAKEN');

      const edited = await http()
        .patch(`/api/v1/scale-profiles/${created.id}`)
        .set(admin)
        .send({ version: 1, columnMapping: { ...mapping, unit: 'KG', weight: ['Peso'] } })
        .expect(200);
      expect(edited.body).toMatchObject({ version: 2, unit: 'KG' });
      await http()
        .patch(`/api/v1/scale-profiles/${created.id}`)
        .set(otherAdmin)
        .send({ version: 2, name: 'Otra' })
        .expect(404);

      const readonly = await http()
        .patch('/api/v1/scale-profiles/tru-test')
        .set(admin)
        .send({ version: 1, name: 'Mía' })
        .expect(409);
      expect(readonly.body.code).toBe('SYSTEM_TEMPLATE_READONLY');

      const copy = await http()
        .post('/api/v1/scale-profiles/tru-test/duplicate')
        .set(admin)
        .send({})
        .expect(201);
      expect(copy.body).toMatchObject({
        name: 'Tru-Test (XR5000, ID5000, S3) (copia)',
        sourceTemplateKey: 'tru-test',
        sourceTemplateVersion: 1,
        system: false,
      });
      await http().post('/api/v1/scale-profiles/tru-test/duplicate').set(vet).send({}).expect(403);

      const other = (await http().get('/api/v1/scale-profiles').set(otherAdmin).expect(200))
        .body as ScaleProfileList;
      expect(other.items.map((item) => item.id)).toEqual(['tru-test']);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('POST /weights/import (PES-04)', () => {
    const session = truTestCsv([
      `${CHIP_COW},087,452.5,15/09/2026,08:01`,
      `${CHIP_STEER},045,318,15/09/2026,08:03`,
      `${CHIP_STEER},045,320,15/09/2026,08:04`,
      `,26-010,180,15/09/2026,08:06`,
      `${CHIP_UNKNOWN},,275,15/09/2026,08:08`,
    ]);

    it('la simulación asocia por chip y por chapeta, avisa repetidos y deja el chip desconocido', async () => {
      await weigh({ animalId: cow, date: '2026-06-15', weightKg: 300 }).expect(201);
      const response = await upload(session, operator, { scaleProfileId: 'tru-test' }).expect(200);
      const body = response.body as WeightImportDryRun;
      expect(body).toMatchObject({
        totalRows: 5,
        unit: 'KG',
        importable: 3,
        profile: { id: 'tru-test', system: true },
        counts: { matched: 3, unknownChips: 1, duplicates: 1, outliers: 1, errors: 0 },
        columns: { eid: 'EID', visualId: 'VID', weight: 'Weight', date: 'Date', time: 'Time' },
      });
      expect(body.rows.map((row) => [row.row, row.status, row.via])).toEqual([
        [2, 'MATCHED', 'RFID'],
        [3, 'DUPLICATE', 'RFID'],
        [4, 'MATCHED', 'RFID'],
        [5, 'MATCHED', 'VISUAL_TAG'],
        [6, 'UNKNOWN_CHIP', null],
      ]);
      expect(body.rows[0]).toMatchObject({ outlier: true, previousKg: 300 });
      expect(body.warnings[0]?.code).toBe('SCALE_DUPLICATE_READING');
      expect(body.unknownChips).toEqual([
        { chip: CHIP_UNKNOWN, rows: [6], weightKg: 275, date: '2026-09-15', visualId: null },
      ]);
      expect(await prisma.weightRecord.count({ where: { weightSource: 'SCALE_FILE' } })).toBe(0);
    });

    it('confirma: jornada de pesaje, chip asociado guardado como RFID, una sola vez por clave', async () => {
      const steer2 = await createAnimal(prisma, esperanza, {
        code: '046',
        sex: 'MALE',
        birthDate: toIsoDate('2025-06-01'),
      });
      const importKey = uuidv7();
      const fields = {
        scaleProfileId: 'tru-test',
        associations: JSON.stringify([{ chip: CHIP_UNKNOWN, animalId: steer2, saveChip: true }]),
        importKey,
        expectedRows: '4',
      };
      const preview = (await upload(session, vet, fields).expect(200)).body as WeightImportDryRun;
      expect(preview.importable).toBe(4);
      expect(preview.chipNotices).toEqual([]);

      const analyzedTables = ['weight_records', 'work_sessions', 'identifiers', 'import_batches'];
      const analyzedBefore = await lastAnalyzed(prisma, analyzedTables);
      const done = (await upload(session, vet, fields, false).expect(201))
        .body as WeightImportResult;
      expect(done).toMatchObject({ created: 4, skipped: 1, chipsSaved: 1, replayed: false });
      // Después de la transacción, en segundo plano: estadísticas frescas para el planificador.
      await app.get(TableStatsService).settled();
      const analyzedAfter = await lastAnalyzed(prisma, analyzedTables);
      for (const table of analyzedTables) {
        expect(analyzedAfter.get(table)?.getTime() ?? 0, table).toBeGreaterThan(
          analyzedBefore.get(table)?.getTime() ?? 0,
        );
      }

      const weights = await prisma.weightRecord.findMany({
        where: { workSessionId: done.workSessionId },
      });
      expect(weights).toHaveLength(4);
      expect(new Set(weights.map((item) => item.method))).toEqual(new Set(['SCALE']));
      expect(new Set(weights.map((item) => item.identifiedBy))).toEqual(new Set(['IMPORT']));
      expect(new Set(weights.map((item) => item.weightSource))).toEqual(new Set(['SCALE_FILE']));
      const sessionRow = await prisma.workSession.findUniqueOrThrow({
        where: { id: done.workSessionId },
      });
      expect(sessionRow).toMatchObject({
        status: 'CLOSED',
        name: 'Pesaje de báscula del 15/09/2026',
      });
      expect(sessionRow.activities).toEqual([{ type: 'WEIGHT', source: 'SCALE_FILE' }]);
      const chip = await prisma.identifier.findFirstOrThrow({
        where: { type: 'RFID', value: CHIP_UNKNOWN },
      });
      expect(chip.animalId).toBe(steer2);

      const again = await upload(session, vet, fields, false).expect(200);
      expect(again.body).toMatchObject({ replayed: true, importBatchId: done.importBatchId });
      expect(await prisma.weightRecord.count({ where: { weightSource: 'SCALE_FILE' } })).toBe(4);

      // La simulación avisa que ese archivo ya se importó.
      const later = (await upload(session, operator, { scaleProfileId: 'tru-test' }).expect(200))
        .body as WeightImportDryRun;
      expect(later.previousImport).toMatchObject({ created: 4 });
    });

    it('un animal que ya tiene otro chip: no se guarda y se avisa', async () => {
      const fields = {
        scaleProfileId: 'tru-test',
        associations: JSON.stringify([{ chip: CHIP_UNKNOWN, animalId: cow, saveChip: true }]),
      };
      const preview = (await upload(session, operator, fields).expect(200))
        .body as WeightImportDryRun;
      expect(preview.chipNotices).toEqual([
        {
          chip: CHIP_UNKNOWN,
          animalId: cow,
          message: `Este animal ya tiene el chip ${CHIP_COW}: revisa la asociación.`,
        },
      ]);
    });

    it('si el resultado cambió desde la simulación, no importa nada (ADR-011)', async () => {
      const response = await upload(
        session,
        operator,
        { scaleProfileId: 'tru-test', importKey: uuidv7(), expectedRows: '9' },
        false,
      ).expect(409);
      expect(response.body.code).toBe('VERSION_CONFLICT');
      expect(await prisma.weightRecord.count()).toBe(0);
    });

    it('perfil en libras: convierte a kilos (0,1 kg) y la simulación lo muestra', async () => {
      const profile = (
        await http()
          .post('/api/v1/scale-profiles')
          .set(admin)
          .send({
            name: 'Báscula en libras',
            fileFormat: 'CSV',
            columnMapping: {
              eid: ['EID'],
              visualId: [],
              weight: ['Weight'],
              date: ['Date'],
              time: [],
              dateFormat: 'DMY',
              unit: 'LB',
            },
          })
          .expect(201)
      ).body as ScaleProfileView;
      const file = truTestCsv([`${CHIP_STEER},,700,15/09/2026,08:00`]);
      const body = (await upload(file, operator, { scaleProfileId: profile.id }).expect(200))
        .body as WeightImportDryRun;
      expect(body.unit).toBe('LB');
      expect(body.rows[0]).toMatchObject({ weightKg: 317.5, originalWeight: 700 });
    });

    it('sin perfil propone el mapeo; un archivo sin columnas reconocibles no se lee', async () => {
      const proposed = (await upload(session, operator).expect(200)).body as WeightImportDryRun;
      expect(proposed.profile).toBeNull();
      expect(proposed.mapping).toMatchObject({ eid: ['EID'], weight: ['Weight'] });
      const bad = {
        data: Buffer.from('Nombre,Observaciones\r\nCanela,ok\r\n'),
        fileName: 'otra.csv',
      };
      expect((await upload(bad, operator).expect(422)).body.code).toBe('SCALE_FILE_INVALID');
    });

    it('otra finca: sus chips no existen aquí y el perfil de esta finca no es suyo', async () => {
      const body = (await upload(session, otherAdmin, { scaleProfileId: 'tru-test' }).expect(200))
        .body as WeightImportDryRun;
      expect(body.counts.matched).toBe(0);
      const profile = (
        await http()
          .post('/api/v1/scale-profiles/tru-test/duplicate')
          .set(admin)
          .send({ name: 'Mía' })
          .expect(201)
      ).body as ScaleProfileView;
      const foreign = await upload(session, otherAdmin, { scaleProfileId: profile.id }).expect(422);
      expect(foreign.body.errors).toHaveProperty('scaleProfileId');
    });
  });
});
