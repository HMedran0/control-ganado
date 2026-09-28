import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLE } from '@hato/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { cleanDatabase, createFarm, createMember, type TestFarm } from './helpers/fixtures.js';

/**
 * Exportación del listado a Excel (ANI-06 CA4): mismos filtros que el listado, fechas y números
 * reales, valor de compra solo para ADMIN (RN-20) y textos a salvo de la inyección de fórmulas.
 */

describe('Exportación del listado (ANI-06 CA4)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let otherFarm: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());

  /** Descarga y abre el libro. */
  const download = async (
    headers: Record<string, string>,
    query = '',
  ): Promise<{ sheet: ExcelJS.Worksheet; headers: Record<string, unknown> }> => {
    const response = await http()
      .get(`/api/v1/animals/export.xlsx${query}`)
      .set(headers)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as ArrayBuffer);
    const sheet = workbook.getWorksheet('Animales');
    if (sheet === undefined) throw new Error('Sin hoja «Animales».');
    return { sheet, headers: response.headers };
  };

  const header = (sheet: ExcelJS.Worksheet): string[] =>
    (sheet.getRow(1).values as unknown[]).slice(1) as string[];

  /** Fila de un código, como objeto encabezado → valor. */
  const rowOf = (sheet: ExcelJS.Worksheet, code: string): Record<string, ExcelJS.CellValue> => {
    const names = header(sheet);
    for (let index = 2; index <= sheet.rowCount; index += 1) {
      const row = sheet.getRow(index);
      if (row.getCell(1).value === code) {
        return Object.fromEntries(
          names.map((name, column) => [name, row.getCell(column + 1).value]),
        );
      }
    }
    throw new Error(`No está el código ${code}.`);
  };

  const create = (
    headers: Record<string, string>,
    target: TestFarm,
    body: Record<string, unknown>,
  ) =>
    http()
      .post('/api/v1/animals')
      .set(headers)
      .send({
        sex: 'FEMALE',
        breedId: target.breedId,
        birthDate: '2022-03-15',
        origin: 'BORN_ON_FARM',
        ...body,
      })
      .expect(201);

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

    await create(admin, farm, {
      code: '087',
      name: 'Canela',
      identifiers: [
        { type: 'VISUAL_TAG', value: '087' },
        { type: 'RFID', value: '170000123456789' },
      ],
      initialWeight: { weightKg: 452.5, weighedOn: '2026-09-01' },
    });
    await create(admin, farm, {
      code: '112',
      name: '=HYPERLINK("http://malo","clic")',
      origin: 'PURCHASED',
      entryDate: '2024-01-10',
      purchasePrice: '3250000.00',
    });
    await create(admin, farm, { code: '300', sex: 'MALE', name: '+57 300' });
    await create(otherAdmin, otherFarm, { code: '999', name: 'De otra finca' });
  });

  it('ADMIN: todas las columnas, fechas y números reales, valor de compra y fila fija', async () => {
    const { sheet, headers } = await download(admin);
    expect(headers['content-type']).toContain('spreadsheetml');
    expect(headers['content-disposition']).toMatch(
      /attachment; filename="animales-\d{4}-\d{2}-\d{2}\.xlsx"/,
    );
    expect(header(sheet)).toContain('Valor de compra');
    expect(header(sheet).slice(0, 5)).toEqual([
      'Código',
      'Nombre',
      'Sexo',
      'Raza',
      'Fecha de nacimiento',
    ]);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.rowCount).toBe(4);

    const canela = rowOf(sheet, '087');
    expect(canela['Fecha de nacimiento']).toEqual(new Date(Date.UTC(2022, 2, 15)));
    expect(canela['Último peso (kg)']).toBe(452.5);
    expect(canela['Fecha último peso']).toEqual(new Date(Date.UTC(2026, 8, 1)));
    expect(canela).toMatchObject({
      Sexo: 'Hembra',
      Chapeta: '087',
      RFID: '170000123456789',
      Estado: 'Activo',
    });
    expect(typeof canela['Edad (meses)']).toBe('number');

    const bought = rowOf(sheet, '112');
    expect(bought['Valor de compra']).toBe(3250000);
    expect(bought).toMatchObject({ Procedencia: 'Comprado' });
    expect(bought['Fecha de ingreso']).toEqual(new Date(Date.UTC(2024, 0, 10)));
  });

  it('los textos que parecen fórmulas se escapan y no son fórmulas', async () => {
    const { sheet } = await download(admin);
    const names = header(sheet);
    const nameColumn = names.indexOf('Nombre') + 1;
    for (const [code, expected] of [
      ['112', `'=HYPERLINK("http://malo","clic")`],
      ['300', `'+57 300`],
    ] as const) {
      const row = [...Array(sheet.rowCount).keys()]
        .map((index) => sheet.getRow(index + 1))
        .find((candidate) => candidate.getCell(1).value === code);
      expect(row?.getCell(nameColumn).value).toBe(expected);
      expect(row?.getCell(nameColumn).formula).toBeUndefined();
    }
  });

  it('respeta los filtros de la URL', async () => {
    const { sheet } = await download(admin, '?sex=FEMALE&sort=-code');
    expect(sheet.getColumn(1).values.slice(2)).toEqual(['112', '087']);
  });

  it('OPERATOR y VET exportan sin el valor de compra (RN-20)', async () => {
    for (const headers of [operator, vet]) {
      const { sheet } = await download(headers);
      expect(header(sheet)).not.toContain('Valor de compra');
      expect(sheet.rowCount).toBe(4);
      const values = JSON.stringify(sheet.getSheetValues());
      expect(values).not.toContain('3250000');
    }
  });

  it('otra finca solo exporta lo suyo; archivados solo ADMIN; sin sesión, 401', async () => {
    const { sheet } = await download(otherAdmin);
    expect(sheet.getColumn(1).values.slice(2)).toEqual(['999']);
    await http().get('/api/v1/animals/export.xlsx?status=archived').set(operator).expect(403);
    await http().get('/api/v1/animals/export.xlsx').expect(401);
    await http().get('/api/v1/animals/export.xlsx?sex=OTRO').set(admin).expect(422);
  });
});
