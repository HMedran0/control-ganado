import { Injectable } from '@nestjs/common';
import {
  ICA_GROUPS_BY_SEX,
  MANAGEMENT_CATEGORY,
  ROLE,
  SEX,
  VACCINE_STATUS,
  isoDateFromParts,
  isoDateParts,
  lastMonths,
  type CalvingsUpcomingReport,
  type ChartsReport,
  type ExitType,
  type ExitsReport,
  type ExitsReportQuery,
  type IcaAgeGroup,
  type IcaInventoryReport,
  type InventoryReport,
  type IsoDate,
  type ManagementCategory,
  type ReportPeriodQuery,
  type Sex,
  type VaccinationPendingReport,
  type VaccinationsReport,
  type VaccinationsReportQuery,
} from '@hato/shared';

import { classificationCtes } from '../animals/classification.sql.js';
import { FarmContextService, classificationParams } from '../animals/farm-context.service.js';
import { vaccineStatusCtes } from '../animals/vaccine-status.sql.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { icaAgeGroupSql, inHerdOnSql } from './reports.sql.js';

const CATEGORIES = Object.values(MANAGEMENT_CATEGORY);
const PENDING_KINDS = [VACCINE_STATUS.OVERDUE, VACCINE_STATUS.PENDING, VACCINE_STATUS.UPCOMING];
/** Meses de las gráficas (RPT-03 CA1). */
export const CHART_MONTHS = 12;

/**
 * Reportes estándar (RPT-02) y gráficas (RPT-03), M8b. Los agregados salen de SQL:
 *
 * - Lo que depende de la categoría o de la edad (inventario, grupos del ICA, pendientes de
 *   vacunación, partos próximos, distribución por categoría) sale de `classificationCtes`, la
 *   misma CTE del listado, de Alertas y del tablero (ADR-009, ADR-017): cada cifra coincide con
 *   su listado, y el grupo del ICA con `icaAgeGroup` (prueba de equivalencia).
 * - La evolución del inventario usa la regla de `wasInHerdOn` en SQL (`inHerdOnSql`).
 * - Los nacimientos por mes, el criterio del reporte de nacimientos (NAC-01).
 *
 * El precio y el comprador de las salidas solo van para el ADMIN (RN-20).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
  ) {}

  async inventory(scope: FarmScope): Promise<InventoryReport> {
    const context = await this.farmContext.load(scope);
    const rows = await this.prisma.$queryRaw<
      {
        category: ManagementCategory;
        sex: Sex;
        breed_id: string;
        breed: string;
        lot_id: string | null;
        lot: string | null;
        count: number;
      }[]
    >`
      WITH ${classificationCtes(classificationParams(scope, context))}
      SELECT c.category, c.sex::text AS sex, a.breed_id, b.name AS breed,
             a.lot_id, l.name AS lot, count(*)::int AS count
        FROM classified c
        JOIN animals a ON a.id = c.animal_id
        JOIN breeds b ON b.id = a.breed_id
        LEFT JOIN lots l ON l.id = a.lot_id
       WHERE c.is_active
       GROUP BY c.category, c.sex, a.breed_id, b.name, a.lot_id, l.name`;

    const add = <K>(
      map: Map<K, { males: number; females: number }>,
      key: K,
      row: (typeof rows)[number],
    ) => {
      const entry = map.get(key) ?? { males: 0, females: 0 };
      if (row.sex === SEX.MALE) entry.males += row.count;
      else entry.females += row.count;
      map.set(key, entry);
    };
    const byCategory = new Map<ManagementCategory, { males: number; females: number }>();
    const byBreed = new Map<string, { males: number; females: number }>();
    const byLot = new Map<string | null, { males: number; females: number }>();
    const breedNames = new Map<string, string>();
    const lotNames = new Map<string | null, string | null>();
    for (const row of rows) {
      add(byCategory, row.category, row);
      add(byBreed, row.breed_id, row);
      add(byLot, row.lot_id, row);
      breedNames.set(row.breed_id, row.breed);
      lotNames.set(row.lot_id, row.lot);
    }
    const withTotal = (entry: { males: number; females: number } | undefined) => {
      const males = entry?.males ?? 0;
      const females = entry?.females ?? 0;
      return { males, females, total: males + females };
    };
    const males = rows
      .filter((row) => row.sex === SEX.MALE)
      .reduce((sum, row) => sum + row.count, 0);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return {
      today: context.today,
      total,
      males,
      females: total - males,
      byCategory: CATEGORIES.map((category) => ({
        category,
        ...withTotal(byCategory.get(category)),
      })),
      byBreed: [...byBreed.entries()]
        .map(([breedId, entry]) => ({
          breedId,
          name: breedNames.get(breedId) ?? '',
          ...withTotal(entry),
        }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es')),
      byLot: [...byLot.entries()]
        .map(([lotId, entry]) => ({
          lotId,
          name: lotNames.get(lotId) ?? null,
          ...withTotal(entry),
        }))
        // Los que no tienen lote, al final.
        .sort((a, b) =>
          a.lotId === null
            ? 1
            : b.lotId === null
              ? -1
              : (a.name ?? '').localeCompare(b.name ?? '', 'es'),
        ),
    };
  }

  async icaInventory(scope: FarmScope): Promise<IcaInventoryReport> {
    const context = await this.farmContext.load(scope);
    const [rows, farm] = await Promise.all([
      this.prisma.$queryRaw<{ sex: Sex; ica_group: IcaAgeGroup; count: number }[]>`
        WITH ${classificationCtes(classificationParams(scope, context))}
        SELECT c.sex::text AS sex, ${icaAgeGroupSql(Prisma.sql`c.sex`, Prisma.sql`c.age_months`)} AS ica_group,
               count(*)::int AS count
          FROM classified c
         WHERE c.is_active
         GROUP BY 1, 2`,
      this.prisma.farm.findUniqueOrThrow({
        where: { id: scope.farmId },
        select: { name: true, municipality: true, department: true, icaPremiseCode: true },
      }),
    ]);
    const countOf = (sex: Sex, group: IcaAgeGroup) =>
      rows.find((row) => row.sex === sex && row.ica_group === group)?.count ?? 0;
    const groups = ([SEX.FEMALE, SEX.MALE] as Sex[]).flatMap((sex) =>
      ICA_GROUPS_BY_SEX[sex].map((group) => ({ sex, group, count: countOf(sex, group) })),
    );
    const sum = (sex: Sex) =>
      groups.filter((item) => item.sex === sex).reduce((total, item) => total + item.count, 0);
    const females = sum(SEX.FEMALE);
    const males = sum(SEX.MALE);
    return {
      today: context.today,
      farm,
      groups,
      totals: { females, males, total: females + males },
    };
  }

  async vaccinations(
    scope: FarmScope,
    query: VaccinationsReportQuery,
  ): Promise<VaccinationsReport> {
    const { from, to } = await this.period(scope, query);
    const records = await this.prisma.vaccinationRecord.findMany({
      where: {
        farmId: scope.farmId,
        voidedAt: null,
        appliedOn: { gte: toPrismaDate(from), lte: toPrismaDate(to) },
        animal: { deletedAt: null },
        ...(query.vaccineId === undefined ? {} : { vaccineId: query.vaccineId }),
      },
      select: {
        id: true,
        appliedOn: true,
        dose: true,
        ruvNumber: true,
        responsible: true,
        animal: { select: { id: true, code: true, name: true } },
        vaccine: { select: { id: true, name: true } },
        cycle: { select: { name: true } },
      },
      orderBy: [{ appliedOn: 'asc' }, { id: 'asc' }],
    });
    const counts = new Map<string, { vaccineId: string; name: string; count: number }>();
    for (const record of records) {
      const entry = counts.get(record.vaccine.id) ?? {
        vaccineId: record.vaccine.id,
        name: record.vaccine.name,
        count: 0,
      };
      entry.count += 1;
      counts.set(record.vaccine.id, entry);
    }
    return {
      from,
      to,
      byVaccine: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
      items: records.map((record) => ({
        id: record.id,
        appliedOn: fromPrismaDate(record.appliedOn),
        animal: record.animal,
        vaccine: record.vaccine,
        dose: record.dose,
        cycle: record.cycle?.name ?? null,
        ruvNumber: record.ruvNumber,
        responsible: record.responsible,
      })),
    };
  }

  /**
   * Dos consultas y no una: unir `vaccine_status` con `classified` (que ya la usa por dentro) hace
   * que PostgreSQL la materialice entera, y con el seed de carga pasaba de 2 s (RNF-01). Las filas
   * salen de `vaccineStatusCtes` sola; la categoría, de la clasificación con el mismo filtro que
   * Alertas, así que los animales son los mismos que cuenta el tablero.
   */
  async vaccinationPending(scope: FarmScope): Promise<VaccinationPendingReport> {
    const context = await this.farmContext.load(scope);
    const params = classificationParams(scope, context);
    const [rows, categories] = await Promise.all([
      this.prisma.$queryRaw<
        {
          animal_id: string;
          code: string;
          name: string | null;
          lot: string | null;
          vaccine_id: string;
          vaccine: string;
          kind: 'OVERDUE' | 'PENDING' | 'UPCOMING';
          due_on: Date | null;
        }[]
      >`
        WITH ${vaccineStatusCtes({ farmId: scope.farmId, today: context.today, vaccineAlertDays: params.vaccineAlertDays })}
        SELECT vs.animal_id, a.code, a.name, l.name AS lot,
               vs.vaccine_id, v.name AS vaccine, vs.kind, vs.due_on
          FROM vaccine_status vs
          JOIN animals a ON a.id = vs.animal_id
          JOIN vaccines v ON v.id = vs.vaccine_id
          LEFT JOIN lots l ON l.id = a.lot_id
         WHERE a.deleted_at IS NULL AND a.exit_type IS NULL
           AND vs.kind = ANY(${PENDING_KINDS}::text[])
         ORDER BY array_position(${PENDING_KINDS}::text[], vs.kind), vs.due_on NULLS LAST,
                  a.code, v.name`,
      this.prisma.$queryRaw<{ animal_id: string; category: ManagementCategory }[]>`
        WITH ${classificationCtes(params)}
        SELECT c.animal_id, c.category
          FROM classified c
         WHERE c.is_active AND (c.vaccine_overdue OR c.vaccine_due)`,
    ]);
    const categoryOf = new Map(categories.map((row) => [row.animal_id, row.category]));
    return {
      today: context.today,
      animals: new Set(rows.map((row) => row.animal_id)).size,
      items: rows.flatMap((row) => {
        const category = categoryOf.get(row.animal_id);
        if (category === undefined) return [];
        return [
          {
            animal: { id: row.animal_id, code: row.code, name: row.name },
            category,
            lot: row.lot,
            vaccine: { id: row.vaccine_id, name: row.vaccine },
            status: row.kind,
            dueOn: row.due_on === null ? null : fromPrismaDate(row.due_on),
          },
        ];
      }),
    };
  }

  async calvingsUpcoming(scope: FarmScope): Promise<CalvingsUpcomingReport> {
    const context = await this.farmContext.load(scope);
    const rows = await this.prisma.$queryRaw<
      {
        pregnancy_id: string;
        dam_id: string;
        code: string;
        name: string | null;
        lot: string | null;
        service_date: Date;
        expected_calving_date: Date;
        days: number;
        sire: string | null;
      }[]
    >`
      WITH ${classificationCtes(classificationParams(scope, context))}
      SELECT p.id AS pregnancy_id, a.id AS dam_id, a.code, a.name, l.name AS lot,
             p.service_date, p.expected_calving_date,
             (p.expected_calving_date - ${context.today}::date)::int AS days,
             COALESCE(s.code, p.sire_external_ref) AS sire
        FROM classified c
        JOIN animals a ON a.id = c.animal_id
        JOIN pregnancies p ON p.dam_id = a.id AND p.farm_id = a.farm_id
             AND p.voided_at IS NULL AND p.outcome = 'PENDING'::"PregnancyOutcome"
             AND p.confirmed_at IS NOT NULL
        LEFT JOIN animals s ON s.id = p.sire_id
        LEFT JOIN lots l ON l.id = a.lot_id
       WHERE c.is_active AND c.calving_soon
       ORDER BY p.expected_calving_date, a.code`;
    return {
      today: context.today,
      windowDays: context.settings.calvingAlertDays,
      items: rows.map((row) => ({
        pregnancyId: row.pregnancy_id,
        dam: { id: row.dam_id, code: row.code, name: row.name },
        lot: row.lot,
        serviceDate: fromPrismaDate(row.service_date),
        expectedCalvingDate: fromPrismaDate(row.expected_calving_date),
        daysToCalving: row.days,
        sire: row.sire,
      })),
    };
  }

  async exits(scope: FarmScope, query: ExitsReportQuery): Promise<ExitsReport> {
    const { from, to } = await this.period(scope, query);
    const admin = scope.role === ROLE.ADMIN;
    const animals = await this.prisma.animal.findMany({
      where: {
        farmId: scope.farmId,
        deletedAt: null,
        exitDate: { gte: toPrismaDate(from), lte: toPrismaDate(to) },
        ...(query.type === undefined ? { exitType: { not: null } } : { exitType: query.type }),
      },
      select: {
        id: true,
        code: true,
        name: true,
        sex: true,
        exitType: true,
        exitDate: true,
        exitReason: true,
        // RN-20: la venta (precio y comprador) ni se consulta para los demás roles.
        ...(admin
          ? {
              sales: {
                where: { voidedAt: null },
                select: { amount: true, buyer: true },
                orderBy: { soldOn: 'desc' as const },
                take: 1,
              },
            }
          : {}),
      },
      orderBy: [{ exitDate: 'asc' }, { code: 'asc' }],
    });
    const counts = new Map<ExitType, number>();
    const items = animals.flatMap((animal) => {
      if (animal.exitType === null || animal.exitDate === null) return [];
      counts.set(animal.exitType, (counts.get(animal.exitType) ?? 0) + 1);
      const sale =
        'sales' in animal
          ? (animal.sales as { amount: Prisma.Decimal; buyer: string | null }[])[0]
          : undefined;
      return [
        {
          animal: { id: animal.id, code: animal.code, name: animal.name, sex: animal.sex },
          exitType: animal.exitType,
          exitDate: fromPrismaDate(animal.exitDate),
          reason: animal.exitReason,
          ...(admin
            ? {
                salePrice: sale === undefined ? null : sale.amount.toFixed(2),
                buyer: sale?.buyer ?? null,
              }
            : {}),
        },
      ];
    });
    return {
      from,
      to,
      byType: [...counts.entries()].map(([type, count]) => ({ type, count })),
      items,
    };
  }

  async charts(scope: FarmScope): Promise<ChartsReport> {
    const context = await this.farmContext.load(scope);
    const months = lastMonths(context.today, CHART_MONTHS);
    const ends = months.map((month) => month.to);
    const first = months[0]?.from ?? context.today;

    const [inventory, births, categories] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; males: number; females: number }[]>`
        SELECT d.day,
               count(a.id) FILTER (WHERE a.sex = 'MALE'::"Sex")::int AS males,
               count(a.id) FILTER (WHERE a.sex = 'FEMALE'::"Sex")::int AS females
          FROM unnest(${ends}::date[]) AS d(day)
          LEFT JOIN animals a ON a.farm_id = ${scope.farmId}::uuid AND ${inHerdOnSql(Prisma.sql`d.day`)}
         GROUP BY d.day
         ORDER BY d.day`,
      this.prisma.$queryRaw<{ month: string; males: number; females: number }[]>`
        SELECT to_char(a.birth_date, 'YYYY-MM') AS month,
               count(*) FILTER (WHERE a.sex = 'MALE'::"Sex")::int AS males,
               count(*) FILTER (WHERE a.sex = 'FEMALE'::"Sex")::int AS females
          FROM animals a
         WHERE a.farm_id = ${scope.farmId}::uuid AND a.deleted_at IS NULL
           AND a.origin = 'BORN_ON_FARM'::"Origin"
           AND a.birth_date BETWEEN ${first}::date AND ${context.today}::date
         GROUP BY 1`,
      this.prisma.$queryRaw<{ category: ManagementCategory; count: number }[]>`
        WITH ${classificationCtes(classificationParams(scope, context))}
        SELECT c.category, count(*)::int AS count
          FROM classified c
         WHERE c.is_active
         GROUP BY c.category`,
    ]);
    const inventoryOn = new Map(inventory.map((row) => [fromPrismaDate(row.day), row]));
    return {
      today: context.today,
      inventoryByMonth: months.map((month) => {
        const row = inventoryOn.get(month.to);
        const males = row?.males ?? 0;
        const females = row?.females ?? 0;
        return { month: month.month, on: month.to, males, females, total: males + females };
      }),
      birthsByMonth: months.map((month) => {
        const row = births.find((item) => item.month === month.month);
        return { month: month.month, males: row?.males ?? 0, females: row?.females ?? 0 };
      }),
      byCategory: CATEGORIES.map((category) => ({
        category,
        count: categories.find((row) => row.category === category)?.count ?? 0,
      })),
    };
  }

  /** Período de un reporte: sin fechas, del 1.º de enero a hoy (como el de nacimientos). */
  private async period(
    scope: FarmScope,
    query: ReportPeriodQuery,
  ): Promise<{ from: IsoDate; to: IsoDate }> {
    const today = (await this.farmContext.load(scope)).today;
    return {
      from: query.from ?? isoDateFromParts(isoDateParts(today).year, 1, 1),
      to: query.to ?? today,
    };
  }
}
