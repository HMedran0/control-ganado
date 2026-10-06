import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  MANAGEMENT_CATEGORY,
  icaAgeGroupFor,
  lastMonths,
  wasInHerdOn,
  type AnimalList,
  type BirthsReport,
  type CalvingsUpcomingReport,
  type ChartsReport,
  type DashboardResponse,
  type ExitsReport,
  type IcaInventoryReport,
  type InventoryReport,
  type VaccinationPendingReport,
  type VaccinationsReport,
} from '@hato/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { SEED_TODAY } from '../prisma/seed/guards.js';
import { EXPECTED_INVENTORY, EXPECTED_RETIRO } from '../prisma/seed/expected.js';
import { runReferenceSeed } from '../prisma/seed/run.js';
import { fromPrismaDate, fromPrismaDateOrNull } from '../src/infra/date-mapper.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { bearer, createTestAppWithClock, signTestToken } from './helpers/app.js';
import { cleanDatabase } from './helpers/fixtures.js';

/**
 * Reportes estándar (RPT-02) y gráficas (RPT-03), M8b, sobre la finca de referencia:
 *
 * - cada cifra coincide con su listado o con el tablero (ADR-009, ADR-017);
 * - pruebas de equivalencia contra las reglas de shared: el grupo del ICA animal por animal
 *   (`icaAgeGroupFor`) y la evolución del inventario (`wasInHerdOn`);
 * - Excel de cada reporte; precio y comprador de las salidas solo para el ADMIN (RN-20);
 * - roles, otra finca y sin sesión.
 */

const PASSWORD = 'contraseña-de-prueba-del-seed';

/** Una celda como texto: fechas como AAAA-MM-DD, vacías como ''. */
function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

describe('Reportes (RPT-02, RPT-03)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let farmId: string;
  let retiroId: string;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let vet: Record<string, string>;
  let retiroAdmin: Record<string, string>;

  const http = () => request(app.getHttpServer());
  const get = async <T>(path: string, headers: Record<string, string> = admin): Promise<T> =>
    (await http().get(`/api/v1${path}`).set(headers).expect(200)).body as T;
  const listTotal = async (query: string, headers = admin): Promise<number> =>
    (await get<AnimalList>(`/animals?limit=1&${query}`, headers)).total;
  const download = async (path: string, headers = admin) => {
    const response = await http()
      .get(`/api/v1${path}`)
      .set(headers)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const workbook = new ExcelJS.Workbook();
    if (response.status === 200) {
      await workbook.xlsx.load(response.body as ArrayBuffer);
    }
    return { response, workbook };
  };
  /** Las filas de una hoja como texto, desde el encabezado de la tabla. */
  const table = (sheet: ExcelJS.Worksheet | undefined, firstHeader: string): string[][] => {
    const rows: string[][] = [];
    sheet?.eachRow((row) => {
      rows.push(
        (row.values as unknown[])
          .slice(1)
          .map((value) =>
            textOf(value),
          ),
      );
    });
    const start = rows.findIndex((row) => row[0] === firstHeader);
    return rows.slice(start);
  };

  beforeAll(async () => {
    ({ app } = await createTestAppWithClock());
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
  }, 180_000);

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('inventario', () => {
    it('total y sexo de expected.ts; cada categoría, raza y lote es el total de su listado', async () => {
      const report = await get<InventoryReport>('/reports/inventory');
      expect(report.today).toBe(SEED_TODAY);
      expect(report.total).toBe(EXPECTED_INVENTORY.active);
      expect(report.males).toBe(EXPECTED_INVENTORY.males);
      expect(report.females).toBe(EXPECTED_INVENTORY.females);
      expect(report.byCategory.map((row) => row.category)).toEqual(
        Object.values(MANAGEMENT_CATEGORY),
      );
      for (const row of report.byCategory) {
        expect(row.total, row.category).toBe(EXPECTED_INVENTORY.category[row.category]);
        expect(row.total).toBe(await listTotal(`category=${row.category}`));
      }
      for (const row of report.byBreed) {
        expect(row.total, row.name).toBe(await listTotal(`breedId=${row.breedId}`));
      }
      for (const row of report.byLot.filter((item) => item.lotId !== null)) {
        expect(row.total, row.name ?? '').toBe(await listTotal(`lotId=${row.lotId ?? ''}`));
      }
      const sum = (rows: readonly { total: number }[]) => rows.reduce((t, r) => t + r.total, 0);
      expect(sum(report.byBreed)).toBe(report.total);
      expect(sum(report.byLot)).toBe(report.total);
    });
  });

  describe('grupos de edad del ICA (08 §2.2)', () => {
    it('equivalencia: cada grupo cuenta lo mismo que icaAgeGroupFor animal por animal', async () => {
      const report = await get<IcaInventoryReport>('/reports/inventory-ica');
      const animals = await prisma.animal.findMany({
        where: { farmId, deletedAt: null, exitType: null },
        select: { sex: true, birthDate: true },
      });
      const expected = new Map<string, number>();
      for (const animal of animals) {
        const key = `${animal.sex}:${icaAgeGroupFor(animal.sex, fromPrismaDate(animal.birthDate), SEED_TODAY)}`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
      for (const row of report.groups) {
        expect(row.count, `${row.sex} ${row.group}`).toBe(
          expected.get(`${row.sex}:${row.group}`) ?? 0,
        );
      }
      expect(report.groups.filter((row) => row.sex === 'FEMALE')).toHaveLength(7);
      expect(report.groups.filter((row) => row.sex === 'MALE')).toHaveLength(6);
      expect(report.totals.total).toBe(EXPECTED_INVENTORY.active);
      expect(report.farm.name).toBe('Finca La Esperanza');
    });

    it('en Excel, con la finca, el código de predio y los totales', async () => {
      const { response, workbook } = await download('/reports/inventory-ica/export?format=xlsx');
      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="grupos-de-edad-ica-${SEED_TODAY}.xlsx"`,
      );
      const sheet = workbook.getWorksheet('Grupos de edad ICA');
      expect(textOf(sheet?.getCell('A1').value)).toContain('Finca La Esperanza');
      const rows = table(sheet, 'Sexo');
      expect(rows[0]).toEqual(['Sexo', 'Grupo de edad', 'Animales']);
      expect(rows.at(-1)?.[0]).toBe('Total');
      expect(rows.at(-1)?.[2]).toBe(String(EXPECTED_INVENTORY.active));
    });
  });

  describe('vacunas', () => {
    it('pendientes: cada animal una vez, lo mismo que el tablero', async () => {
      const report = await get<VaccinationPendingReport>('/reports/vaccination-pending');
      const board = await get<DashboardResponse>('/dashboard');
      expect(report.animals).toBe(board.vaccines.pending);
      const overdue = new Set(
        report.items.filter((row) => row.status === 'OVERDUE').map((row) => row.animal.id),
      );
      expect(overdue.size).toBe(board.vaccines.overdue);
      expect(
        report.items.every((row) => ['OVERDUE', 'PENDING', 'UPCOMING'].includes(row.status)),
      ).toBe(true);
    });

    it('vacunados del período: las aplicaciones no anuladas de la base', async () => {
      const report = await get<VaccinationsReport>('/reports/vaccinations?from=2026-01-01');
      const count = await prisma.vaccinationRecord.count({
        where: {
          farmId,
          voidedAt: null,
          animal: { deletedAt: null },
          appliedOn: { gte: new Date('2026-01-01'), lte: new Date(SEED_TODAY) },
        },
      });
      expect(report.items).toHaveLength(count);
      expect(report.byVaccine.reduce((t, r) => t + r.count, 0)).toBe(count);
      const one = report.byVaccine[0];
      if (one !== undefined) {
        const only = await get<VaccinationsReport>(
          `/reports/vaccinations?from=2026-01-01&vaccineId=${one.vaccineId}`,
        );
        expect(only.items).toHaveLength(one.count);
      }
    });

    it('fechas al revés: 422', async () => {
      await http()
        .get('/api/v1/reports/vaccinations?from=2026-05-01&to=2026-01-01')
        .set(admin)
        .expect(422);
    });
  });

  describe('partos próximos', () => {
    it('lo mismo que el tablero, ordenados por fecha estimada', async () => {
      const report = await get<CalvingsUpcomingReport>('/reports/calvings-upcoming');
      const board = await get<DashboardResponse>('/dashboard');
      expect(report.items).toHaveLength(board.reproduction.calvingSoon);
      expect(report.items[0]?.dam.id).toBe(board.reproduction.nextCalving?.animalId);
      const dates = report.items.map((row) => row.expectedCalvingDate);
      expect([...dates].sort()).toEqual(dates);
    });
  });

  describe('vendidos y retirados', () => {
    it('las salidas del período; precio y comprador solo para el ADMIN (RN-20)', async () => {
      const path = '/reports/exits?from=2024-01-01';
      const own = await get<ExitsReport>(path);
      const count = await prisma.animal.count({
        where: {
          farmId,
          deletedAt: null,
          exitType: { not: null },
          exitDate: { gte: new Date('2024-01-01') },
        },
      });
      expect(own.items).toHaveLength(count);
      expect(own.items.some((row) => row.exitType === 'SALE' && row.salePrice !== null)).toBe(true);
      for (const headers of [operator, vet]) {
        const other = await get<ExitsReport>(path, headers);
        expect(other.items).toHaveLength(count);
        for (const row of other.items) {
          expect(row).not.toHaveProperty('salePrice');
          expect(row).not.toHaveProperty('buyer');
        }
      }
      const sales = await get<ExitsReport>(`${path}&type=SALE`);
      expect(sales.items.every((row) => row.exitType === 'SALE')).toBe(true);
    });

    it('en Excel: la columna del precio no existe para el OPERATOR', async () => {
      const adminFile = await download('/reports/exits/export?from=2024-01-01');
      expect(table(adminFile.workbook.getWorksheet('Salidas'), 'Fecha')[0]).toContain(
        'Precio de venta',
      );
      const operatorFile = await download('/reports/exits/export?from=2024-01-01', operator);
      expect(operatorFile.response.status).toBe(200);
      const header = table(operatorFile.workbook.getWorksheet('Salidas'), 'Fecha')[0];
      expect(header).not.toContain('Precio de venta');
      expect(header).not.toContain('Comprador');
    });
  });

  describe('gráficas (RPT-03)', () => {
    it('equivalencia: la evolución del inventario es wasInHerdOn al cierre de cada mes', async () => {
      const report = await get<ChartsReport>('/reports/charts');
      const months = lastMonths(SEED_TODAY, 12);
      expect(report.inventoryByMonth.map((row) => row.month)).toEqual(months.map((m) => m.month));
      const animals = await prisma.animal.findMany({
        where: { farmId },
        select: { sex: true, entryDate: true, exitDate: true, deletedAt: true },
      });
      for (const row of report.inventoryByMonth) {
        const present = animals.filter((animal) =>
          wasInHerdOn(
            {
              entryDate: fromPrismaDate(animal.entryDate),
              exitDate: fromPrismaDateOrNull(animal.exitDate),
              archived: animal.deletedAt !== null,
            },
            row.on,
          ),
        );
        expect(row.total, row.month).toBe(present.length);
        expect(row.males, row.month).toBe(present.filter((a) => a.sex === 'MALE').length);
      }
      // El último mes termina hoy: es el inventario activo.
      expect(report.inventoryByMonth.at(-1)?.total).toBe(EXPECTED_INVENTORY.active);
    });

    it('nacimientos por mes: lo mismo que el reporte de nacimientos de cada mes', async () => {
      const report = await get<ChartsReport>('/reports/charts');
      for (const month of lastMonths(SEED_TODAY, 12)) {
        const births = await get<BirthsReport>(`/reports/births?from=${month.from}&to=${month.to}`);
        const row = report.birthsByMonth.find((item) => item.month === month.month);
        expect(row, month.month).toEqual({
          month: month.month,
          males: births.totals.males,
          females: births.totals.females,
        });
      }
    });

    it('distribución por categoría: la del inventario', async () => {
      const [charts, inventory] = await Promise.all([
        get<ChartsReport>('/reports/charts'),
        get<InventoryReport>('/reports/inventory'),
      ]);
      expect(charts.byCategory).toEqual(
        inventory.byCategory.map((row) => ({ category: row.category, count: row.total })),
      );
    });
  });

  describe('Excel de cada reporte (RPT-02 CA1)', () => {
    it.each([
      ['inventory', 'inventario', 'Por categoría', 'Categoría'],
      ['vaccination-pending', 'pendientes-de-vacunacion', 'Pendientes', 'Animal'],
      ['calvings-upcoming', 'partos-proximos', 'Partos próximos', 'Hembra'],
      ['vaccinations', 'vacunados', 'Vacunados', 'Fecha'],
      ['births', 'nacimientos', 'Nacimientos', 'Fecha'],
    ])('%s', async (name, file, sheetName, firstHeader) => {
      const { response, workbook } = await download(`/reports/${name}/export?format=xlsx`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      expect(response.headers['content-disposition']).toMatch(
        new RegExp(`^attachment; filename="${file}-[0-9a-z-]+\\.xlsx"$`),
      );
      expect(table(workbook.getWorksheet(sheetName), firstHeader).length).toBeGreaterThan(1);
    });

    it('avance del ciclo: pide el ciclo', async () => {
      await http().get('/api/v1/reports/cycle-progress/export').set(admin).expect(422);
      const cycle = await prisma.vaccinationCycle.findFirstOrThrow({ where: { farmId } });
      const { response, workbook } = await download(
        `/reports/cycle-progress/export?cycleId=${cycle.id}`,
      );
      expect(response.status).toBe(200);
      expect(table(workbook.getWorksheet('Avance del ciclo'), 'Vacuna')[0]).toEqual([
        'Vacuna',
        'Debían vacunarse',
        'Vacunados',
        'Faltan',
      ]);
    });

    it('formato distinto de xlsx: 422; reporte que no existe: 404', async () => {
      await http().get('/api/v1/reports/inventory/export?format=pdf').set(admin).expect(422);
      await http().get('/api/v1/reports/economic/export').set(admin).expect(404);
      await http().get('/api/v1/reports/nada/export').set(admin).expect(404);
    });
  });

  describe('roles y finca', () => {
    it('OPERATOR y VET ven los reportes', async () => {
      for (const headers of [operator, vet]) {
        expect((await get<InventoryReport>('/reports/inventory', headers)).total).toBe(
          EXPECTED_INVENTORY.active,
        );
        await get<ChartsReport>('/reports/charts', headers);
      }
    });

    it('otra finca: solo sus datos', async () => {
      const report = await get<InventoryReport>('/reports/inventory', retiroAdmin);
      expect(report.total).toBe(EXPECTED_RETIRO.active);
      const ica = await get<IcaInventoryReport>('/reports/inventory-ica', retiroAdmin);
      expect(ica.farm.name).toBe('Finca El Retiro');
      expect(ica.totals.total).toBe(EXPECTED_RETIRO.active);
      const cycle = await prisma.vaccinationCycle.findFirstOrThrow({ where: { farmId } });
      await http()
        .get(`/api/v1/reports/cycle-progress/export?cycleId=${cycle.id}`)
        .set(retiroAdmin)
        .expect(404);
    });

    it('sin sesión: 401', async () => {
      await http().get('/api/v1/reports/inventory').expect(401);
      await http().get('/api/v1/reports/inventory/export').expect(401);
    });
  });
});
