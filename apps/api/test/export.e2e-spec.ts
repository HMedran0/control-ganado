import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AUDIT_ACTION } from '@hato/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { EXPORT_SHEETS } from '../src/export/export-sheets.js';
import { readZipEntries, type ZipEntry } from '../src/imports/zip-guard.js';
import { Clock } from '../src/infra/clock.service.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestApp, signTestToken } from './helpers/app.js';
import { cleanDatabase } from './helpers/fixtures.js';

/**
 * Exportación completa de la finca (BAK-02, ADR-018) contra la finca de referencia: el ZIP se
 * abre, trae un Excel por entidad con los encabezados del LEEME, lo archivado y lo anulado, nada
 * de contraseñas ni tokens, el texto protegido contra fórmulas, queda auditado, tiene el límite de
 * 3 por hora por finca y una sola a la vez en el servidor.
 */

const PASSWORD = 'contraseña-de-prueba-del-seed';
const LIMITS = { maxTotalBytes: 200 * 1024 * 1024, maxEntries: 100 };
const GLOBAL_LOCK_KEY = 'hato:export-full';

type Download = { status: number; headers: Record<string, string>; body: Buffer };

describe('GET /export/full (BAK-02)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farmId: string;
  let retiroId: string;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let retiroAdmin: Record<string, string>;
  /** La primera exportación de La Esperanza, abierta una vez para varias pruebas. */
  let entries: ZipEntry[];
  let download: Download;

  const get = async (headers: Record<string, string>): Promise<Download> => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/export/full')
      .set(headers)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body as Buffer,
    };
  };

  const clearExports = () => prisma.auditLog.deleteMany({ where: { action: AUDIT_ACTION.EXPORT } });

  /** Todas las filas de un Excel del ZIP, como texto, con el encabezado primero. */
  const rowsOf = async (zip: ZipEntry[], file: string): Promise<string[][]> => {
    const entry = zip.find((item) => item.name === file);
    if (entry === undefined) throw new Error(`Falta ${file}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(entry.data as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      rows.push(
        values
          .slice(1)
          .map((value) =>
            value === null || value === undefined
              ? ''
              : value instanceof Date
                ? value.toISOString()
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value as string | number | boolean),
          ),
      );
    });
    return rows;
  };

  /** El texto de todas las partes de todos los Excel y del LEEME. */
  const allText = (zip: ZipEntry[]): string =>
    zip
      .flatMap((entry) =>
        entry.name.endsWith('.xlsx')
          ? readZipEntries(entry.data, LIMITS).map((part) => part.data.toString('utf8'))
          : [entry.data.toString('utf8')],
      )
      .join('\n');

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const { seed, retiro } = await runReferenceSeed(prisma, {
      password: PASSWORD,
      today: SEED_TODAY,
    });
    farmId = seed.catalog.farmId;
    retiroId = retiro.farmId;
    const token = async (username: string, farm: string) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username } });
      return bearer(await signTestToken(app, { userId: user.id, farmId: farm }));
    };
    admin = await token('alvaro', farmId);
    operator = await token('wilmer', farmId);
    vet = await token('paola.vet', farmId);
    retiroAdmin = await token('retiro.admin', retiroId);

    // Un texto que una hoja de cálculo ejecutaría (M4d): debe salir con apóstrofo.
    const target = await prisma.animal.findFirstOrThrow({
      where: { farmId, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    await prisma.animal.update({
      where: { id: target.id },
      data: { notes: '=HYPERLINK("http://example.com","clic")' },
    });

    download = await get(admin);
    entries = download.status === 200 ? readZipEntries(download.body, LIMITS) : [];
  }, 240_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('el ZIP', () => {
    it('200, application/zip, nombre ASCII con la fecha', () => {
      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toBe('application/zip');
      expect(download.headers['content-disposition']).toMatch(
        /^attachment; filename="arreo-finca-la-esperanza-\d{4}-\d{2}-\d{2}\.zip"$/,
      );
      expect(download.headers['cache-control']).toBe('no-store');
    });

    it('un Excel por entidad y el LEEME, todos con nombre ASCII (ADR-018)', () => {
      expect(entries.map((entry) => entry.name).sort()).toEqual(
        [...EXPORT_SHEETS.map((sheet) => sheet.file), 'LEEME.txt'].sort(),
      );
      for (const entry of entries) expect(entry.name).toMatch(/^[a-z0-9.-]+$/i);
    });

    it('cada Excel trae en la primera fila los encabezados que describe el LEEME', async () => {
      const readme = entries.find((entry) => entry.name === 'LEEME.txt')?.data ?? Buffer.alloc(0);
      // UTF-8 con BOM para el Bloc de notas.
      expect([...readme.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = readme.toString('utf8');
      expect(text).toContain('preñez');
      for (const sheet of EXPORT_SHEETS) {
        const rows = await rowsOf(entries, sheet.file);
        expect(rows[0], sheet.file).toEqual(sheet.columns.map((column) => column.header));
        expect(text, sheet.file).toContain(sheet.file);
        for (const column of sheet.columns) expect(text).toContain(`${column.header}: `);
      }
    });

    it('todos los animales, también los que salieron y los archivados, marcados', async () => {
      const rows = await rowsOf(entries, 'animales.xlsx');
      const header = rows[0] ?? [];
      const archived = header.indexOf('Archivado');
      const exitType = header.indexOf('Tipo de salida');
      const data = rows.slice(1);
      expect(data).toHaveLength(await prisma.animal.count({ where: { farmId } }));
      expect(data.filter((row) => row[archived] === 'Sí')).toHaveLength(
        await prisma.animal.count({ where: { farmId, deletedAt: { not: null } } }),
      );
      expect(data.filter((row) => (row[exitType] ?? '') !== '')).toHaveLength(
        await prisma.animal.count({ where: { farmId, exitType: { not: null } } }),
      );
    });

    it('los eventos anulados vienen con «Anulado: Sí», y los de otra finca no vienen', async () => {
      for (const [file, count, voided] of [
        [
          'pesajes.xlsx',
          prisma.weightRecord.count({ where: { farmId } }),
          prisma.weightRecord.count({ where: { farmId, voidedAt: { not: null } } }),
        ],
        [
          'gastos.xlsx',
          prisma.expense.count({ where: { farmId } }),
          prisma.expense.count({ where: { farmId, voidedAt: { not: null } } }),
        ],
        [
          'vacunaciones.xlsx',
          prisma.vaccinationRecord.count({ where: { farmId } }),
          prisma.vaccinationRecord.count({ where: { farmId, voidedAt: { not: null } } }),
        ],
      ] as const) {
        const rows = await rowsOf(entries, file);
        const column = (rows[0] ?? []).indexOf('Anulado');
        expect(rows.length - 1, file).toBe(await count);
        expect(rows.filter((row) => row[column] === 'Sí').length, file).toBe(await voided);
      }
      expect(await prisma.expense.count({ where: { farmId, voidedAt: { not: null } } })).toBe(1);
    });

    it('sin contraseñas ni tokens: ni hashes, ni la contraseña, ni los refresh tokens', async () => {
      const text = allText(entries);
      expect(text).not.toContain('$argon2');
      expect(text).not.toContain(PASSWORD);
      const hashes = await prisma.user.findMany({ select: { passwordHash: true } });
      for (const { passwordHash } of hashes) expect(text).not.toContain(passwordHash);
      const tokens = await prisma.refreshToken.findMany({ select: { tokenHash: true } });
      for (const { tokenHash } of tokens) expect(text).not.toContain(tokenHash);
      const users = await rowsOf(entries, 'usuarios.xlsx');
      expect(users[0]?.some((header) => /^contraseña$|hash|token/i.test(header))).toBe(false);
      expect(users.slice(1).map((row) => row[1])).toEqual(
        expect.arrayContaining(['alvaro', 'wilmer', 'paola.vet']),
      );
    });

    it('el texto que parece fórmula sale con apóstrofo (M4d)', async () => {
      const rows = await rowsOf(entries, 'animales.xlsx');
      const notes = (rows[0] ?? []).indexOf('Observaciones');
      expect(rows.some((row) => row[notes] === `'=HYPERLINK("http://example.com","clic")`)).toBe(
        true,
      );
      expect(allText(entries)).not.toMatch(/<f>/);
    });

    it('queda auditada: quién y cuándo', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username: 'alvaro' } });
      const logs = await prisma.auditLog.findMany({
        where: { farmId, action: AUDIT_ACTION.EXPORT },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ userId: user.id, entity: 'Farm', entityId: farmId });
    });
  });

  describe('límites (ADR-018)', () => {
    beforeEach(clearExports);

    it('3 por hora por finca: la cuarta es 429 con Retry-After, y otra finca no se afecta', async () => {
      for (let index = 0; index < 3; index += 1) expect((await get(admin)).status).toBe(200);
      const fourth = await request(app.getHttpServer())
        .get('/api/v1/export/full')
        .set(admin)
        .expect(429);
      expect(fourth.body).toMatchObject({ code: 'EXPORT_LIMIT_REACHED' });
      expect(fourth.body.detail).toMatch(/3 veces en la última hora/);
      const retryAfter = Number(fourth.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(3_500);
      expect(retryAfter).toBeLessThanOrEqual(3_600);
      // La rechazada no cuenta.
      expect(await prisma.auditLog.count({ where: { farmId, action: AUDIT_ACTION.EXPORT } })).toBe(
        3,
      );
      expect((await get(retiroAdmin)).status).toBe(200);
    }, 120_000);

    it('pasada la hora, se puede otra vez', async () => {
      // Con el reloj de la API (el de las pruebas está fijo en el 25/09/2026).
      const longAgo = new Date(app.get(Clock).now().getTime() - 61 * 60_000);
      await prisma.auditLog.createMany({
        data: Array.from({ length: 3 }, () => ({
          farmId,
          entity: 'Farm',
          entityId: farmId,
          action: AUDIT_ACTION.EXPORT,
          createdAt: longAgo,
        })),
      });
      const again = await get(admin);
      expect(again.status, again.body.toString('utf8').slice(0, 300)).toBe(200);
    }, 60_000);

    it('una a la vez en el servidor: con otra en curso, 429 con Retry-After corto', async () => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // Otra exportación: alguien tiene el candado global dentro de su transacción.
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${GLOBAL_LOCK_KEY}, 0))`;
          locked();
          await released;
        },
        { timeout: 30_000 },
      );
      await isLocked;
      try {
        const busy = await request(app.getHttpServer())
          .get('/api/v1/export/full')
          .set(retiroAdmin)
          .expect(429);
        expect(busy.body).toMatchObject({
          code: 'EXPORT_IN_PROGRESS',
          detail: 'Hay otra exportación en curso; intenta en un minuto.',
        });
        expect(busy.headers['retry-after']).toBe('60');
        // Ocupado no cuenta para el límite.
        expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION.EXPORT } })).toBe(0);
      } finally {
        release();
        await holder;
      }
      expect((await get(retiroAdmin)).status).toBe(200);
    }, 60_000);
  });

  describe('roles y finca', () => {
    beforeEach(clearExports);

    it('OPERATOR y VET: 403, sin auditoría', async () => {
      for (const headers of [operator, vet]) {
        const response = await request(app.getHttpServer())
          .get('/api/v1/export/full')
          .set(headers)
          .expect(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN_ROLE' });
      }
      expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION.EXPORT } })).toBe(0);
    });

    it('sin sesión: 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/export/full').expect(401);
    });

    it('el ADMIN de otra finca solo recibe la suya', async () => {
      const other = await get(retiroAdmin);
      expect(other.status).toBe(200);
      const zip = readZipEntries(other.body, LIMITS);
      const rows = await rowsOf(zip, 'animales.xlsx');
      expect(rows.length - 1).toBe(await prisma.animal.count({ where: { farmId: retiroId } }));
      const esperanzaIds = new Set(
        (await prisma.animal.findMany({ where: { farmId }, select: { id: true } })).map(
          (animal) => animal.id,
        ),
      );
      expect(rows.slice(1).some((row) => esperanzaIds.has(row[0] ?? ''))).toBe(false);
      const farm = await rowsOf(zip, 'finca.xlsx');
      expect(farm.find((row) => row[0] === 'Nombre')?.[1]).toBe('Finca El Retiro');
      expect(other.headers['content-disposition']).toContain('arreo-finca-el-retiro-');
    });
  });
});
