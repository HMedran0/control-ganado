import { Injectable } from '@nestjs/common';
import {
  ANIMAL_ALERT,
  CALVING_INTERVAL_BUCKETS,
  DASHBOARD_QUESTION,
  MANAGEMENT_CATEGORY,
  ORIGIN,
  ROLE,
  SALE_WEIGHT_STATUS,
  SEX,
  endOfMonth,
  gainFromMilli,
  isoDateFromParts,
  isoDateParts,
  salesFocusSex,
  systemQuestions,
  weaningBirthRange,
  type AnimalAlert,
  type DashboardLotGain,
  type DashboardResponse,
  type HerdCalvingIntervals,
  type IsoDate,
} from '@hato/shared';

import { ALERT_COLUMN } from '../animals/animal-list.service.js';
import { classificationCtes } from '../animals/classification.sql.js';
import { FarmContextService, classificationParams } from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { investmentCte } from '../finance/investment.sql.js';
import { Prisma } from '../generated/prisma/client.js';
import { toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { herdCalvingIntervalsSql, type HerdCalvingIntervalsRow } from './calving-intervals.sql.js';

const ALL_ALERTS = Object.values(ANIMAL_ALERT);

/** Fila de los indicadores sobre los animales activos. */
type SummaryRow = {
  total: number;
  males: number;
  females: number;
  calves_male: number;
  calves_female: number;
  pregnant: number;
  served: number;
  calving_soon: number;
  calving_overdue: number;
  next_calving: { animal_id: string; code: string; expected: string } | null;
  alerts: number[];
  vaccine_pending: number;
  for_sale: number;
  dry: number;
  milk_withdrawal: number;
  weaning_count: number;
  weaning_weighed: number;
  weaning_avg_kg: number | null;
  sale_reached: number;
  sale_this_month: number;
  sale_likely: number;
  sale_later: number;
  days_to_sale_avg: number | null;
  days_to_sale_n: number;
  lots: {
    lot_id: string;
    name: string;
    animals: number;
    gain_sum: number;
    threshold_sum: number;
    low_gain: number;
  }[];
};

/**
 * Tablero de Inicio (RPT-01, CFG-03; M8a). Todos los agregados salen de SQL, con la misma CTE de
 * clasificación del listado y de Alertas (ADR-009), en **una** consulta sobre los activos: así
 * cada cifra coincide con el total del listado filtrado al que enlaza y la clasificación se
 * calcula una sola vez. El intervalo entre partos (RN-38) es una consulta aparte, sin la
 * clasificación; los nacimientos del año siguen el criterio del reporte de nacimientos (NAC-01).
 *
 * El sistema productivo solo decide qué secciones propias se calculan y se envían (CFG-03 CA1);
 * las comunes salen siempre. La inversión del hato solo existe para el ADMIN (RN-20).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
  ) {}

  async dashboard(scope: FarmScope): Promise<DashboardResponse> {
    const context = await this.farmContext.load(scope);
    const { settings, today } = context;
    const questions = systemQuestions(settings.productionSystem);
    const asks = (question: (typeof questions)[number]) => questions.includes(question);
    const focusSex = salesFocusSex(settings.salesFocus);
    const weaning = weaningBirthRange(today, settings.weaningAgeMonths);
    const yearStart = isoDateFromParts(isoDateParts(today).year, 1, 1);
    const isAdmin = scope.role === ROLE.ADMIN;
    const needsLots = asks(DASHBOARD_QUESTION.LOW_GAIN_LOTS);

    const [summary, births, cycle, intervals, investment] = await Promise.all([
      this.summary(scope, context, { focusSex, weaning, needsLots }),
      this.births(scope, yearStart, today),
      this.prisma.vaccinationCycle.findFirst({
        where: {
          farmId: scope.farmId,
          isActive: true,
          startsOn: { lte: toPrismaDate(today) },
          endsOn: { gte: toPrismaDate(today) },
        },
        select: { id: true, name: true },
        orderBy: { startsOn: 'desc' },
      }),
      asks(DASHBOARD_QUESTION.CALVING_INTERVAL)
        ? this.calvingIntervals(scope)
        : Promise.resolve(null),
      // RN-20: para los demás roles la inversión ni se consulta.
      isAdmin ? this.investment(scope) : Promise.resolve(null),
    ]);

    const alerts = Object.fromEntries(
      ALL_ALERTS.map((alert, index) => [alert, summary.alerts[index] ?? 0]),
    ) as Record<AnimalAlert, number>;

    const response: DashboardResponse = {
      today,
      productionSystem: settings.productionSystem,
      salesFocus: settings.salesFocus,
      questions,
      herd: {
        total: summary.total,
        males: summary.males,
        females: summary.females,
        calvesMale: summary.calves_male,
        calvesFemale: summary.calves_female,
      },
      reproduction: {
        pregnant: summary.pregnant,
        served: summary.served,
        calvingSoon: summary.calving_soon,
        calvingOverdue: summary.calving_overdue,
        nextCalving:
          summary.next_calving === null
            ? null
            : {
                animalId: summary.next_calving.animal_id,
                code: summary.next_calving.code,
                expectedCalvingDate: summary.next_calving.expected as IsoDate,
              },
      },
      births: { from: yearStart, to: today, ...births },
      vaccines: {
        pending: summary.vaccine_pending,
        overdue: alerts[ANIMAL_ALERT.VACCINE_OVERDUE],
        due: alerts[ANIMAL_ALERT.VACCINE_DUE],
        currentCycle: cycle,
      },
      alerts,
      forSale: { count: summary.for_sale, sex: focusSex },
      ...(asks(DASHBOARD_QUESTION.WEANING)
        ? {
            weaning: {
              bornFrom: weaning.from,
              bornTo: weaning.to,
              count: summary.weaning_count,
              weighed: summary.weaning_weighed,
              averageWeightKg: summary.weaning_avg_kg,
            },
          }
        : {}),
      ...(intervals === null ? {} : { calvingInterval: intervals }),
      ...(asks(DASHBOARD_QUESTION.DRY_COWS) ? { dryCows: { count: summary.dry } } : {}),
      ...(asks(DASHBOARD_QUESTION.MILK_WITHDRAWAL)
        ? { milkWithdrawal: { count: summary.milk_withdrawal } }
        : {}),
      ...(asks(DASHBOARD_QUESTION.SALE_WEIGHT)
        ? {
            saleWeight: {
              monthEnd: endOfMonth(today),
              reached: summary.sale_reached,
              thisMonth: summary.sale_this_month,
              likelyReached: summary.sale_likely,
              later: summary.sale_later,
            },
          }
        : {}),
      ...(needsLots ? { lotGains: lotGains(summary.lots) } : {}),
      ...(asks(DASHBOARD_QUESTION.DAYS_TO_SALE)
        ? {
            daysToSale: {
              averageDays: summary.days_to_sale_avg,
              animals: summary.days_to_sale_n,
            },
          }
        : {}),
      ...(investment === null ? {} : { investment }),
    };
    return response;
  }

  /** Indicadores sobre los activos, en una sola pasada de la clasificación. */
  private async summary(
    scope: FarmScope,
    context: Awaited<ReturnType<FarmContextService['load']>>,
    options: {
      focusSex: string | null;
      weaning: { from: IsoDate; to: IsoDate };
      needsLots: boolean;
    },
  ): Promise<SummaryRow> {
    const today = Prisma.sql`${context.today}::date`;
    const alertCounts = ALL_ALERTS.map(
      (alert) => Prisma.sql`count(*) FILTER (WHERE ${ALERT_COLUMN[alert]})::int`,
    );
    const forSale =
      options.focusSex === null
        ? Prisma.sql`c.for_sale`
        : Prisma.sql`(c.for_sale AND c.sex = ${options.focusSex}::"Sex")`;
    const status = (value: string) => Prisma.sql`c.sale_weight_status = ${value}::text`;
    const upcoming = Prisma.sql`c.sale_weight_status IN (${SALE_WEIGHT_STATUS.THIS_MONTH}::text, ${SALE_WEIGHT_STATUS.LATER}::text)`;
    const weaned = Prisma.sql`c.birth_date BETWEEN ${options.weaning.from}::date AND ${options.weaning.to}::date`;
    // Lotes con su ganancia de 90 días frente al umbral (PES-05 CA4): solo animales con los dos.
    const lots = options.needsLots
      ? Prisma.sql`(
          SELECT COALESCE(json_agg(l ORDER BY l.name), '[]'::json) FROM (
            SELECT c.lot_id, lo.name,
              count(*) FILTER (WHERE c.gain_90_milli IS NOT NULL AND c.gain_threshold_milli IS NOT NULL)::int AS animals,
              COALESCE(sum(c.gain_90_milli) FILTER (WHERE c.gain_threshold_milli IS NOT NULL), 0)::bigint AS gain_sum,
              COALESCE(sum(c.gain_threshold_milli) FILTER (WHERE c.gain_90_milli IS NOT NULL), 0)::bigint AS threshold_sum,
              count(*) FILTER (WHERE c.low_gain)::int AS low_gain
            FROM act c JOIN lots lo ON lo.id = c.lot_id
            GROUP BY c.lot_id, lo.name
          ) l
        )`
      : Prisma.sql`'[]'::json`;

    const rows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      WITH ${classificationCtes(classificationParams(scope, context))},
      act AS MATERIALIZED (
        SELECT k.*, a.code, a.birth_date, a.for_sale, a.lot_id
        FROM classified k JOIN animals a ON a.id = k.animal_id
        WHERE k.is_active
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE c.sex = ${SEX.MALE}::"Sex")::int AS males,
        count(*) FILTER (WHERE c.sex = ${SEX.FEMALE}::"Sex")::int AS females,
        count(*) FILTER (WHERE c.category = ${MANAGEMENT_CATEGORY.CALF_MALE}::text)::int AS calves_male,
        count(*) FILTER (WHERE c.category = ${MANAGEMENT_CATEGORY.CALF_FEMALE}::text)::int AS calves_female,
        count(*) FILTER (WHERE c.pregnant)::int AS pregnant,
        count(*) FILTER (WHERE c.served)::int AS served,
        count(*) FILTER (WHERE c.calving_soon)::int AS calving_soon,
        count(*) FILTER (WHERE c.calving_overdue)::int AS calving_overdue,
        (array_agg(json_build_object(
            'animal_id', c.animal_id, 'code', c.code,
            'expected', to_char(c.open_expected_calving_date, 'YYYY-MM-DD'))
          ORDER BY c.open_expected_calving_date, c.animal_id)
          FILTER (WHERE c.calving_soon))[1] AS next_calving,
        ARRAY[${Prisma.join(alertCounts, ', ')}] AS alerts,
        count(*) FILTER (WHERE c.vaccine_overdue OR c.vaccine_due)::int AS vaccine_pending,
        count(*) FILTER (WHERE ${forSale})::int AS for_sale,
        count(*) FILTER (WHERE c.dry)::int AS dry,
        count(*) FILTER (WHERE c.milk_withdrawal)::int AS milk_withdrawal,
        count(*) FILTER (WHERE ${weaned})::int AS weaning_count,
        count(*) FILTER (WHERE ${weaned} AND c.weight_last_cents IS NOT NULL)::int AS weaning_weighed,
        (round(avg(c.weight_last_cents) FILTER (WHERE ${weaned}) / 100.0, 1))::float8 AS weaning_avg_kg,
        count(*) FILTER (WHERE ${status(SALE_WEIGHT_STATUS.REACHED)})::int AS sale_reached,
        count(*) FILTER (WHERE ${status(SALE_WEIGHT_STATUS.THIS_MONTH)})::int AS sale_this_month,
        count(*) FILTER (WHERE ${status(SALE_WEIGHT_STATUS.LIKELY_REACHED)})::int AS sale_likely,
        count(*) FILTER (WHERE ${status(SALE_WEIGHT_STATUS.LATER)})::int AS sale_later,
        round(avg(c.sale_weight_on - ${today}) FILTER (WHERE ${upcoming}))::int AS days_to_sale_avg,
        count(*) FILTER (WHERE ${upcoming})::int AS days_to_sale_n,
        ${lots} AS lots
      FROM act c`);
    const row = rows[0];
    if (row === undefined) throw new Error('La consulta del tablero no devolvió fila.');
    return row;
  }

  /** Nacidos en la finca en el año, vivos y no archivados: el criterio de NAC-01. */
  private async births(
    scope: FarmScope,
    from: IsoDate,
    to: IsoDate,
  ): Promise<{ live: number; males: number; females: number }> {
    const groups = await this.prisma.animal.groupBy({
      by: ['sex'],
      where: {
        farmId: scope.farmId,
        deletedAt: null,
        origin: ORIGIN.BORN_ON_FARM,
        birthDate: { gte: toPrismaDate(from), lte: toPrismaDate(to) },
      },
      _count: { _all: true },
    });
    const males = groups.find((group) => group.sex === SEX.MALE)?._count._all ?? 0;
    const females = groups.find((group) => group.sex === SEX.FEMALE)?._count._all ?? 0;
    return { live: males + females, males, females };
  }

  /** Intervalo entre partos de las hembras activas (RN-38), en SQL. */
  private async calvingIntervals(scope: FarmScope): Promise<HerdCalvingIntervals> {
    const rows = await this.prisma.$queryRaw<HerdCalvingIntervalsRow[]>(
      herdCalvingIntervalsSql(scope.farmId),
    );
    const row = rows[0];
    return {
      count: row?.count ?? 0,
      females: row?.females ?? 0,
      averageDays: row?.average_days ?? null,
      distribution: CALVING_INTERVAL_BUCKETS.map(({ key }, index) => ({
        bucket: key,
        count: row?.distribution[index] ?? 0,
      })),
    };
  }

  /** Inversión del hato activo (RN-18), solo ADMIN: la misma CTE que el reporte económico. */
  private async investment(scope: FarmScope): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
      WITH ${investmentCte(scope.farmId)}
      SELECT COALESCE(sum(i.total), 0)::numeric(14,2)::text AS total
      FROM investment i JOIN animals a ON a.id = i.animal_id
      WHERE a.farm_id = ${scope.farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL`);
    return rows[0]?.total ?? '0.00';
  }
}

/**
 * Lotes por debajo del umbral (PES-05 CA4): el promedio de la ganancia de 90 días de sus animales
 * es menor que el promedio de sus umbrales. Sobre el mismo conjunto, eso es comparar las sumas,
 * en enteros (milésimas de kg/día). Un lote sin animales con ganancia y umbral no se evalúa.
 */
function lotGains(rows: SummaryRow['lots']): {
  belowThreshold: DashboardLotGain[];
  others: DashboardLotGain[];
} {
  const lots = rows
    .filter((row) => row.animals > 0)
    .map((row) => ({
      row,
      view: {
        lotId: row.lot_id,
        name: row.name,
        animals: row.animals,
        averageGain: gainFromMilli(Math.round(Number(row.gain_sum) / row.animals)),
        averageThreshold: gainFromMilli(Math.round(Number(row.threshold_sum) / row.animals)),
        lowGain: row.low_gain,
      },
    }));
  return {
    belowThreshold: lots
      .filter(({ row }) => Number(row.gain_sum) < Number(row.threshold_sum))
      .map(({ view }) => view),
    others: lots
      .filter(({ row }) => Number(row.gain_sum) >= Number(row.threshold_sum))
      .map(({ view }) => view),
  };
}
