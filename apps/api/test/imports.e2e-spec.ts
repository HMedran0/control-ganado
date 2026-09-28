import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  BREED_GROUP,
  ROLE,
  uuidv7,
  type AnimalDetail,
  type AnimalImportPreview,
  type AnimalImportResultView,
} from '@hato/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { craftZip, windows1252, zipBomb } from './helpers/crafted-files.js';
import { cleanDatabase, createFarm, createMember, type TestFarm } from './helpers/fixtures.js';

/**
 * Importación del inventario (ANI-09, ADR-011) contra PostgreSQL real: la plantilla de
 * referencia tal cual (`docs/referencia/plantilla-importacion.xlsx`), archivos armados para
 * atacar el lector, idempotencia, roles y finca.
 */

const TEMPLATE = readFileSync(
  fileURLToPath(new URL('../../../docs/referencia/plantilla-importacion.xlsx', import.meta.url)),
);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_HEADER = 'Código;Nombre;Sexo;Raza;Fecha de nacimiento;Lote';

type Upload = { data: Buffer; fileName: string; contentType: string };
const xlsx = (data: Buffer, fileName = 'inventario.xlsx'): Upload => ({
  data,
  fileName,
  contentType: XLSX,
});
const csv = (text: string | Buffer, fileName = 'inventario.csv'): Upload => ({
  data: typeof text === 'string' ? Buffer.from(text, 'utf8') : text,
  fileName,
  contentType: 'text/csv',
});

describe('Importación del inventario (ANI-09)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farm: TestFarm;
  let otherFarm: TestFarm;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let otherAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());

  const post = (
    path: string,
    headers: Record<string, string>,
    upload: Upload,
    fields: Record<string, string> = {},
  ) => {
    let call = http().post(`/api/v1${path}`).set(headers);
    for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
    return call.attach('file', upload.data, {
      filename: upload.fileName,
      contentType: upload.contentType,
    });
  };
  const preview = (headers: Record<string, string>, upload: Upload, fields = {}) =>
    post('/imports/animals?dryRun=true', headers, upload, fields);
  const confirm = (
    headers: Record<string, string>,
    upload: Upload,
    fields: Record<string, string> = {},
  ) => post('/imports/animals', headers, upload, { importKey: uuidv7(), ...fields });

  /** Catálogo de la finca de referencia (08 §3) en una finca de prueba. */
  const seedCatalog = async (target: TestFarm): Promise<void> => {
    const breeds: [string, (typeof BREED_GROUP)[keyof typeof BREED_GROUP], number][] = [
      ['Cebú comercial', BREED_GROUP.INDICUS, 293],
      ['Romosinuano', BREED_GROUP.TAURUS, 283],
      ['Cruce', BREED_GROUP.CROSS, 288],
      ['Girolando', BREED_GROUP.CROSS, 288],
      ['Brahman × Pardo', BREED_GROUP.CROSS, 288],
    ];
    await prisma.breed.createMany({
      data: breeds.map(([name, group, gestationDays]) => ({
        id: uuidv7(),
        farmId: target.farmId,
        name,
        group,
        gestationDays,
      })),
    });
    await prisma.lot.createMany({
      data: ['Paridas', 'Horras y novillas', 'Levante', 'Toros'].map((name) => ({
        id: uuidv7(),
        farmId: target.farmId,
        name,
      })),
    });
  };

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
    farm = await createFarm(prisma, 'La Nueva');
    otherFarm = await createFarm(prisma, 'El Retiro');
    await seedCatalog(farm);
    await seedCatalog(otherFarm);
    admin = bearer(await signTestToken(app, { userId: farm.userId, farmId: farm.farmId }));
    const op = await createMember(prisma, farm, ROLE.OPERATOR);
    const doctor = await createMember(prisma, farm, ROLE.VET);
    operator = bearer(await signTestToken(app, { userId: op.userId, farmId: farm.farmId }));
    vet = bearer(await signTestToken(app, { userId: doctor.userId, farmId: farm.farmId }));
    otherAdmin = bearer(
      await signTestToken(app, { userId: otherFarm.userId, farmId: otherFarm.farmId }),
    );
  });

  const animalsOf = (target: TestFarm) =>
    prisma.animal.findMany({ where: { farmId: target.farmId }, orderBy: { code: 'asc' } });

  describe('la plantilla de referencia', () => {
    it('simulación: 11 filas entran y la 13 tiene su error, sin guardar nada', async () => {
      const response = await preview(admin, xlsx(TEMPLATE, 'plantilla-importacion.xlsx')).expect(
        200,
      );
      const body = response.body as AnimalImportPreview;
      expect(body).toMatchObject({
        fileName: 'plantilla-importacion.xlsx',
        totalRows: 12,
        importable: 11,
        errorRows: 1,
        previousImport: null,
      });
      expect(body.issues.filter((issue) => issue.severity === 'error')).toEqual([
        { row: 13, column: 'dam', severity: 'error', message: 'La madre 012 es macho.' },
      ]);
      expect(await animalsOf(farm)).toEqual([]);
      expect(await prisma.importBatch.count()).toBe(0);
    });

    it('confirmar crea los 11 animales con todo lo del archivo, en una transacción', async () => {
      const response = await confirm(admin, xlsx(TEMPLATE), { expectedRows: '11' }).expect(201);
      expect(response.body).toMatchObject({ created: 11, skipped: 1, replayed: false });
      const body = response.body as AnimalImportResultView;

      const animals = await animalsOf(farm);
      expect(animals.map((animal) => animal.code)).toEqual([
        '012',
        '055',
        '087',
        '112',
        '140',
        '201',
        '25-044',
        '25-050',
        '26-012',
        '26-031',
        '300',
      ]);

      const byCode = new Map(animals.map((animal) => [animal.code, animal]));
      const canela = byCode.get('087');
      expect(canela).toMatchObject({
        name: 'Canela',
        importedPriorCalvings: 3,
        sireExternalRef: '012',
      });
      expect(byCode.get('26-031')).toMatchObject({
        damId: canela?.id,
        sireId: byCode.get('012')?.id,
      });
      expect(byCode.get('25-044')?.damId).toBe(byCode.get('055')?.id);
      expect(byCode.get('112')).toMatchObject({
        origin: 'PURCHASED',
        entryDateEstimated: true,
        birthDateEstimated: true,
        sireExternalRef: 'IA pajilla Gyr',
      });

      // Ficha: 4 partos (3 importados sin fecha y el último con fecha), vaca, parida.
      const detail = (await http().get(`/api/v1/animals/${canela?.id}`).set(admin).expect(200))
        .body as AnimalDetail;
      expect(detail).toMatchObject({
        category: 'COW',
        calvingCount: 4,
        reproduction: { calvingCount: 4, importedPriorCalvings: 3, lastCalvingDate: '2026-07-30' },
        lastWeight: { weightKg: 452 },
      });
      const lucero = (
        await http()
          .get(`/api/v1/animals/${byCode.get('112')?.id}`)
          .set(admin)
          .expect(200)
      ).body as AnimalDetail;
      expect(lucero.derivedTags).toContain('PREGNANT');
      expect(lucero.entryDateEstimated).toBe(true);

      const pregnancies = await prisma.pregnancy.findMany({ where: { damId: canela?.id } });
      expect(pregnancies).toHaveLength(1);
      expect(pregnancies[0]).toMatchObject({
        outcome: 'CALVED',
        isImported: true,
        serviceDateEstimated: true,
      });
      const identifiers = await prisma.identifier.findMany({
        where: { animalId: byCode.get('26-012')?.id },
        orderBy: { type: 'asc' },
      });
      expect(identifiers.map((item) => [item.type, item.value])).toEqual([
        ['DIN', 'CO0100000234567'],
        ['RFID', '170000123456789'],
      ]);

      const batch = await prisma.importBatch.findUniqueOrThrow({
        where: { id: body.importBatchId },
      });
      expect(batch).toMatchObject({ totalRows: 12, createdRows: 11, errorRows: 1 });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { farmId: farm.farmId, action: 'IMPORT' },
      });
      expect(audit).toMatchObject({ entity: 'ImportBatch', entityId: batch.id });
      expect(audit.diff).toMatchObject({ totalRows: 12, createdRows: 11, errorRows: 1 });
      expect(
        await prisma.auditLog.count({
          where: { farmId: farm.farmId, action: 'CREATE', entity: 'Animal' },
        }),
      ).toBe(11);
    });

    it('el mismo archivo otra vez: la simulación avisa y cada código ya existe', async () => {
      await confirm(admin, xlsx(TEMPLATE)).expect(201);
      const body = (await preview(admin, xlsx(TEMPLATE)).expect(200)).body as AnimalImportPreview;
      expect(body.previousImport).toMatchObject({ createdRows: 11 });
      expect(body.importable).toBe(0);
      expect(body.issues).toContainEqual({
        row: 2,
        column: 'code',
        severity: 'error',
        message: 'Ya existe un animal con el código 087.',
      });
    });

    it('descarga las filas con error con su columna «Error»', async () => {
      const response = await post('/imports/animals/errors', admin, xlsx(TEMPLATE))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ArrayBuffer);
      const sheet = workbook.getWorksheet('Animales');
      expect(sheet?.rowCount).toBe(2);
      const header = (sheet?.getRow(1).values as unknown[]).slice(1);
      const errorColumn = header.indexOf('Error') + 1;
      expect(sheet?.getRow(2).getCell(1).value).toBe('26-040');
      expect(sheet?.getRow(2).getCell(errorColumn).value).toBe(
        'Código madre: La madre 012 es macho.',
      );
    });
  });

  describe('una sola vez (idempotencia, ADR-011)', () => {
    it('repetir la clave devuelve el mismo lote sin importar otra vez', async () => {
      const importKey = uuidv7();
      const first = (await confirm(admin, xlsx(TEMPLATE), { importKey }).expect(201))
        .body as AnimalImportResultView;
      const second = await confirm(admin, xlsx(TEMPLATE), { importKey }).expect(200);
      expect(second.body).toEqual({ ...first, replayed: true });
      expect(await animalsOf(farm)).toHaveLength(11);
    });

    it('un doble clic (dos confirmaciones a la vez) importa una sola vez', async () => {
      const importKey = uuidv7();
      const responses = await Promise.all([
        confirm(admin, xlsx(TEMPLATE), { importKey }),
        confirm(admin, xlsx(TEMPLATE), { importKey }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
      expect(await animalsOf(farm)).toHaveLength(11);
      expect(await prisma.importBatch.count()).toBe(1);
    });

    it('si el resultado cambió desde la simulación, no se importa nada', async () => {
      const response = await confirm(admin, xlsx(TEMPLATE), { expectedRows: '12' }).expect(409);
      expect(response.body).toMatchObject({ code: 'VERSION_CONFLICT' });
      expect(response.body.detail).toContain('ahora entrarían 11 animales y no 12');
      expect(await animalsOf(farm)).toEqual([]);
    });

    it('filas desmarcadas: no entran, y tampoco sus crías', async () => {
      const response = await confirm(admin, xlsx(TEMPLATE), { skipRows: '2' }).expect(201);
      // Sin 087 no entran sus crías 26-031 y 140.
      expect(response.body).toMatchObject({ created: 8 });
      expect((await animalsOf(farm)).map((animal) => animal.code)).not.toContain('087');
    });
  });

  describe('validación', () => {
    it('un código repetido dentro del mismo archivo (normalizado, RN-30)', async () => {
      const body = (
        await preview(
          admin,
          csv(
            `${CSV_HEADER}\n5;Uno;Hembra;Brahman;01/02/2023;\n05;Dos;Macho;Brahman;01/03/2023;\n7;;Hembra;Brahman;01/03/2023;`,
          ),
        ).expect(200)
      ).body as AnimalImportPreview;
      expect(body.importable).toBe(1);
      expect(body.issues).toEqual([
        {
          row: 2,
          column: 'code',
          severity: 'error',
          message: 'El código 5 está repetido en la fila 3 de este archivo.',
        },
        {
          row: 3,
          column: 'code',
          severity: 'error',
          message: 'El código 05 está repetido en la fila 2 de este archivo.',
        },
      ]);
    });

    it('un código de la finca, un identificador ocupado y la madre en la finca', async () => {
      await confirm(
        admin,
        csv('Código;Sexo;Raza;Fecha de nacimiento;DIN\n900;Hembra;Brahman;01/01/2018;CO1'),
      ).expect(201);
      const body = (
        await preview(
          admin,
          csv(
            'Código;Sexo;Raza;Fecha de nacimiento;DIN;Código madre\n900;Macho;Brahman;01/01/2020;;\n901;Hembra;Brahman;01/01/2021;co-1;\n902;Hembra;Brahman;01/01/2022;;900',
          ),
        ).expect(200)
      ).body as AnimalImportPreview;
      expect(body.issues).toEqual([
        {
          row: 2,
          column: 'code',
          severity: 'error',
          message: 'Ya existe un animal con el código 900.',
        },
        {
          row: 3,
          column: 'din',
          severity: 'error',
          message: 'El identificador CO1 ya está asignado al animal 900.',
        },
      ]);
      expect(body.importable).toBe(1);
    });

    it('razas que no existen: error, o se crean como Cruce si se pide', async () => {
      const file = csv(`${CSV_HEADER}\nH1;;Hembra;Holstein;01/01/2022;`);
      const without = (await preview(admin, file).expect(200)).body as AnimalImportPreview;
      expect(without.importable).toBe(0);
      const withFlag = (await preview(admin, file, { createMissingBreeds: 'true' }).expect(200))
        .body as AnimalImportPreview;
      expect(withFlag).toMatchObject({ importable: 1, newBreeds: ['Holstein'] });

      await confirm(admin, file, { createMissingBreeds: 'true' }).expect(201);
      const breed = await prisma.breed.findFirstOrThrow({
        where: { farmId: farm.farmId, name: 'Holstein' },
      });
      expect(breed).toMatchObject({ group: 'CROSS', gestationDays: 288 });
    });

    it('faltan columnas obligatorias: 422 con cuáles', async () => {
      const response = await preview(admin, csv('Código;Nombre\n1;Uno')).expect(422);
      expect(response.body).toMatchObject({ code: 'IMPORT_FILE_INVALID' });
      expect(response.body.detail).toContain('Faltan las columnas Sexo, Raza, Fecha de nacimiento');
    });

    it('más de 5.000 filas: 413', async () => {
      const rows = Array.from(
        { length: 5001 },
        (_, index) => `${index + 1};;Hembra;Brahman;01/01/2022;`,
      );
      const response = await preview(admin, csv([CSV_HEADER, ...rows].join('\n'))).expect(413);
      expect(response.body).toMatchObject({ code: 'IMPORT_TOO_MANY_ROWS' });
    });

    it('de las fórmulas lee el valor guardado; sin valor, error de la fila', async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Animales');
      sheet.addRow(['Código*', 'Sexo*', 'Raza*', 'Fecha de nacimiento*', 'Nombre']);
      sheet.addRow([
        'F1',
        'Hembra',
        'Brahman',
        new Date(Date.UTC(2022, 0, 1)),
        { formula: 'UPPER("canela")', result: 'CANELA' },
      ]);
      sheet.addRow([
        'F2',
        'Hembra',
        'Brahman',
        new Date(Date.UTC(2022, 0, 1)),
        { formula: 'NOW()' },
      ]);
      const body = (
        await preview(admin, xlsx(Buffer.from(await workbook.xlsx.writeBuffer()))).expect(200)
      ).body as AnimalImportPreview;
      expect(body.importable).toBe(1);
      expect(body.issues).toEqual([
        {
          row: 3,
          column: 'name',
          severity: 'error',
          message:
            'La celda tiene una fórmula sin valor guardado. Ábrela en Excel, guárdala y vuelve a subirla.',
        },
      ]);
    });
  });

  describe('archivos armados a propósito', () => {
    const invalid = async (upload: Upload, detail: string | RegExp): Promise<void> => {
      const response = await preview(admin, upload).expect(422);
      expect(response.body).toMatchObject({ code: 'IMPORT_FILE_INVALID' });
      expect(response.body.detail).toMatch(detail);
    };

    it('un .xlsm renombrado a .xlsx se rechaza por su contenido', async () => {
      const macro = craftZip([
        {
          name: '[Content_Types].xml',
          data: '<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>',
        },
        { name: 'xl/workbook.xml', data: '<workbook/>' },
        { name: 'xl/vbaProject.bin', data: Buffer.alloc(64, 1) },
      ]);
      await invalid(xlsx(macro, 'inventario.xlsx'), /macros/);
      await invalid(xlsx(TEMPLATE, 'inventario.xlsm'), /macros/);
    });

    it('una bomba ZIP pequeña se corta sin inflarla entera', async () => {
      const bomb = zipBomb(200);
      expect(bomb.length).toBeLessThan(1024 * 1024);
      await invalid(xlsx(bomb), /de forma segura/);
    });

    it('un ZIP con entradas que intentan salir de la carpeta', async () => {
      const traversal = craftZip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: '../../etc/cron.d/hato', data: 'x' },
      ]);
      await invalid(xlsx(traversal), /de forma segura/);
    });

    it('el tipo real manda, no la extensión', async () => {
      await invalid(
        csv(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10)])),
        /no es texto/,
      );
      await invalid(xlsx(Buffer.from(`${CSV_HEADER}\n1;;Hembra;Brahman;01/01/2022;`)), /no lo es/);
      await invalid(csv(TEMPLATE), /no es texto/);
      await invalid(
        { data: Buffer.from('hola'), fileName: 'foto.png', contentType: 'image/png' },
        /\.xlsx o \.csv/,
      );
    });

    it('más de 5 MB: 413', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0x41);
      const response = await preview(admin, csv(big)).expect(413);
      expect(response.body).toMatchObject({ code: 'IMPORT_FILE_TOO_LARGE' });
    });

    it('un CSV en Windows-1252 con tildes y ñ', async () => {
      const text = `Código;Nombre;Sexo;Raza;Fecha de nacimiento;Lote\nÑ-1;Ñata Mariñosa;Hembra;Cebú comercial;01/02/2023;Horras y novillas`;
      const file = csv(windows1252(text));
      expect(file.data.includes(Buffer.from('Ñ', 'utf8'))).toBe(false);
      const body = (await preview(admin, file).expect(200)).body as AnimalImportPreview;
      expect(body).toMatchObject({ importable: 1, errorRows: 0 });
      await confirm(admin, file).expect(201);
      expect(await animalsOf(farm)).toMatchObject([{ code: 'Ñ-1', name: 'Ñata Mariñosa' }]);
    });

    it('celdas =CMD(...) se guardan como texto y salen escapadas en el archivo de errores', async () => {
      const file = csv(
        `${CSV_HEADER}\nC1;=CMD("calc");Hembra;Brahman;01/02/2023;\nC2;@SUM(A1);Hembra;Brahman;01/02/2023;No existe`,
      );
      await confirm(admin, file).expect(201);
      expect(await animalsOf(farm)).toMatchObject([{ code: 'C1', name: '=CMD("calc")' }]);

      const response = await post('/imports/animals/errors', admin, file)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ArrayBuffer);
      // C1 también sale: al volver a leer el archivo su código ya existe.
      const sheet = workbook.getWorksheet('Animales');
      const names = [2, 3].map((index) => sheet?.getRow(index).getCell(2));
      expect(names.map((cell) => cell?.value)).toEqual(['\'=CMD("calc")', "'@SUM(A1)"]);
      expect(names.map((cell) => cell?.formula)).toEqual([undefined, undefined]);
    });
  });

  describe('roles y finca', () => {
    it('OPERATOR y VET no pueden: 403 en la plantilla, la simulación, la confirmación y los errores', async () => {
      for (const headers of [operator, vet]) {
        await http().get('/api/v1/imports/animals/template').set(headers).expect(403);
        await preview(headers, xlsx(TEMPLATE)).expect(403);
        await confirm(headers, xlsx(TEMPLATE)).expect(403);
        await post('/imports/animals/errors', headers, xlsx(TEMPLATE)).expect(403);
      }
      expect(await animalsOf(farm)).toEqual([]);
    });

    it('otra finca importa en la suya: no ve los códigos de esta ni escribe aquí', async () => {
      await confirm(admin, xlsx(TEMPLATE)).expect(201);
      const body = (await preview(otherAdmin, xlsx(TEMPLATE)).expect(200))
        .body as AnimalImportPreview;
      expect(body).toMatchObject({ importable: 11, previousImport: null });
      await confirm(otherAdmin, xlsx(TEMPLATE)).expect(201);
      expect(await animalsOf(otherFarm)).toHaveLength(11);
      expect(await animalsOf(farm)).toHaveLength(11);
    });

    it('la plantilla trae el catálogo de la finca en sus listas', async () => {
      const response = await http()
        .get('/api/v1/imports/animals/template')
        .set(admin)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-disposition']).toContain('plantilla-importacion-hato.xlsx');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as ArrayBuffer);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'Instrucciones',
        'Animales',
        'Listas',
      ]);
      const lists = workbook.getWorksheet('Listas');
      const breeds = lists?.getColumn(2).values.slice(2);
      expect(breeds).toEqual([
        'Brahman',
        'Brahman × Pardo',
        'Cebú comercial',
        'Cruce',
        'Girolando',
        'Romosinuano',
      ]);
      const header = (workbook.getWorksheet('Animales')?.getRow(1).values as unknown[]).slice(1);
      expect(header.slice(0, 5)).toEqual([
        'Código*',
        'Nombre',
        'Sexo*',
        'Raza*',
        'Fecha de nacimiento*',
      ]);
      expect(header).toContain('Fecha de ingreso');
    });
  });

  describe('rendimiento (CA7)', () => {
    it('5.000 filas válidas se confirman dentro del tiempo máximo de 60 s', async () => {
      const rows = Array.from(
        { length: 5000 },
        (_, index) =>
          `P-${index + 1};;${index % 2 === 0 ? 'Hembra' : 'Macho'};Brahman;01/01/2022;Levante;${index + 1}`,
      );
      const file = csv([`${CSV_HEADER};Chapeta visual`, ...rows].join('\n'));
      const started = performance.now();
      const response = await confirm(admin, file, { expectedRows: '5000' });
      const seconds = (performance.now() - started) / 1000;
      process.stdout.write(`
[ANI-09] 5.000 filas confirmadas en ${seconds.toFixed(1)} s
`);
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ created: 5000 });
      expect(seconds).toBeLessThan(60);
      expect(await prisma.animal.count({ where: { farmId: farm.farmId } })).toBe(5000);
    }, 120_000);
  });
});
