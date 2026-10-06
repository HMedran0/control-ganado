import {
  ADULT_MALE_AGE_MONTHS,
  BREEDER_TAG_KEY,
  DERIVED_TAG,
  MANAGEMENT_CATEGORY,
  PREGNANCY_OUTCOME,
  SALE_WEIGHT_STATUS,
  SEX,
  endOfMonth,
  gainToMilli,
  weightCents,
  type DerivedTag,
  type IsoDate,
  type ManagementCategory,
} from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';
import { vaccineStatusCtes } from './vaccine-status.sql.js';
import { weightGainCtes } from './weight-gain.sql.js';

/**
 * Clasificación de los animales en SQL (RN-06, RN-07, RN-08, RN-25; docs/adr/009).
 *
 * Es la traducción de `managementCategory`, `derivedTags`, `isCalvingSoon`,
 * `isServiceUnconfirmedOverdue`, `isCalvingOverdue` y, desde M6, `vaccineStatus`
 * (`vaccine-status.sql.ts`) y `weightAlerts` (`weight-gain.sql.ts`) de `@hato/shared` a una CTE,
 * para poder **filtrar y contar**
 * miles de animales en la base. Mostrar un animal no pasa por aquí: la ficha y cada fila del
 * listado se calculan con las funciones de shared a partir de las columnas crudas que esta CTE
 * también expone. Que las dos cosas coincidan (RN-27) lo comprueba
 * `test/classification-equivalence.e2e-spec.ts` animal por animal sobre el seed.
 *
 * Todo valor —la fecha de hoy, los parámetros de la finca, los códigos de categoría, etiqueta y
 * desenlace— entra como parámetro de `Prisma.sql`. El texto fijo solo contiene nombres de
 * columnas, tablas y tipos. La regla de meses es `hato_months_between` (ADR-002), probada contra
 * `monthsBetween` de shared.
 */

/** Parámetros de la clasificación. Los de la finca salen de `farms.settings`, no del código. */
export type ClassificationParams = {
  readonly farmId: string;
  readonly today: IsoDate;
  readonly weaningAgeMonths: number;
  readonly calvingAlertDays: number;
  readonly unconfirmedServiceAlertDays: number;
  /** «Parto vencido sin registrar» (M5), 15 por defecto [Validar]. */
  readonly overdueCalvingAlertDays: number;
  /** Ventana de vacuna próxima (RN-13), M6. */
  readonly vaccineAlertDays: number;
  /** Umbral de «Ganancia baja» por categoría, en kg/día (PES-05 CA2), M6. */
  readonly weightGainAlertKgPerDay: Partial<Readonly<Record<ManagementCategory, number>>>;
  /** «Perdió peso» (PES-05 CA3), M6. */
  readonly weightLossAlertPercent: number;
  /** Antigüedad máxima del ancla de la ganancia de 90 días (ADR-015), M6. */
  readonly weightGainAnchorMaxDays: number;
  /** Peso objetivo de venta por categoría, en kilos (PES-06), M8a. */
  readonly targetSaleWeightKg: Partial<Readonly<Record<ManagementCategory, number>>>;
};

/** Umbral de ganancia de la categoría `k.category` en milésimas de kg/día, o NULL. */
function gainThresholdSql(params: ClassificationParams): Prisma.Sql {
  const categories = Object.values(MANAGEMENT_CATEGORY);
  const entries = categories.flatMap((category) => {
    const value = params.weightGainAlertKgPerDay[category];
    return value === undefined ? [] : [[category, gainToMilli(value)] as const];
  });
  if (entries.length === 0) return Prisma.sql`NULL::int`;
  const branches = entries.map(
    ([category, milli]) => Prisma.sql`WHEN ${category}::text THEN ${milli}::int`,
  );
  return Prisma.sql`CASE k.category ${Prisma.join(branches, ' ')} ELSE NULL::int END`;
}

/** Peso objetivo de venta de la categoría `k.category` en centésimas de kilo, o NULL (PES-06). */
function saleTargetSql(params: ClassificationParams): Prisma.Sql {
  const entries = Object.values(MANAGEMENT_CATEGORY).flatMap((category) => {
    const value = params.targetSaleWeightKg[category];
    return value === undefined ? [] : [[category, weightCents(value)] as const];
  });
  if (entries.length === 0) return Prisma.sql`NULL::bigint`;
  const branches = entries.map(
    ([category, cents]) => Prisma.sql`WHEN ${category}::text THEN ${cents}::bigint`,
  );
  return Prisma.sql`CASE k.category ${Prisma.join(branches, ' ')} ELSE NULL::bigint END`;
}

const outcome = (value: string): Prisma.Sql => Prisma.sql`${value}::"PregnancyOutcome"`;

/**
 * CTE `classified`, una fila por animal de la finca (de cualquier estado), con:
 *
 * - `animal_id`, `age_months`;
 * - hechos crudos: `calving_count`, `last_calving_date`, `open_service_date`,
 *   `open_confirmed_at`, `open_expected_calving_date`, `withdrawal_until`;
 * - derivados: `category`, `served`, `pregnant`, `calved`, `dry`, `withdrawal`,
 *   `calving_soon`, `unconfirmed_service`, `calving_overdue`;
 * - desde M6: `vaccine_overdue`, `vaccine_due` (solo activos, de `vaccine_status`), las ganancias
 *   `gain_last_two_milli`, `gain_90_milli`, `gain_birth_milli`, y `low_gain` y `weight_loss`
 *   (solo activos). La CTE `vaccine_status` queda disponible para quien la necesite (Alertas,
 *   avance de un ciclo);
 * - desde M8a: `is_breeder` (etiqueta del sistema «Reproductor»), `milk_withdrawal_until` y
 *   `milk_withdrawal` (retiro de leche vigente, solo activos), `gain_threshold_milli` (umbral de
 *   ganancia de su categoría), y el peso de venta de `saleWeightProjection` (PES-06):
 *   `sale_target_cents`, `sale_weight_on` (fecha estimada) y `sale_weight_status` (solo
 *   activos, con los valores de `SALE_WEIGHT_STATUS`).
 *
 * Se usa como `WITH ${classificationCtes(params)} SELECT … FROM classified c …`.
 */
export function classificationCtes(params: ClassificationParams): Prisma.Sql {
  const { farmId, today, weaningAgeMonths } = params;
  const todayDate = Prisma.sql`${today}::date`;
  const monthEnd = Prisma.sql`${endOfMonth(today)}::date`;
  // Fecha estimada de saleWeightProjection: último pesaje + ⌈10 · faltante / ganancia⌉ días, en
  // enteros (centésimas de kilo y milésimas de kg/día; los dos positivos aquí).
  const saleEstimate = Prisma.sql`(k.weight_last_on + ((10 * (k.sale_target_cents - k.weight_last_cents) + k.gain_90_milli - 1) / k.gain_90_milli)::int)`;

  return Prisma.sql`
    ${vaccineStatusCtes({ farmId, today, vaccineAlertDays: params.vaccineAlertDays })},
    ${weightGainCtes({ farmId, today, anchorMaxDays: params.weightGainAnchorMaxDays })},
    reproduction AS (
      SELECT p.dam_id,
        count(*) FILTER (WHERE p.outcome = ${outcome(PREGNANCY_OUTCOME.CALVED)})::int AS calving_count,
        max(p.outcome_date) FILTER (WHERE p.outcome = ${outcome(PREGNANCY_OUTCOME.CALVED)}) AS last_calving_date,
        max(p.service_date) FILTER (WHERE p.outcome = ${outcome(PREGNANCY_OUTCOME.PENDING)}) AS open_service_date,
        max(p.confirmed_at) FILTER (WHERE p.outcome = ${outcome(PREGNANCY_OUTCOME.PENDING)}) AS open_confirmed_at,
        max(p.expected_calving_date) FILTER (WHERE p.outcome = ${outcome(PREGNANCY_OUTCOME.PENDING)}) AS open_expected_calving_date
      FROM pregnancies p
      WHERE p.farm_id = ${farmId}::uuid AND p.voided_at IS NULL
      GROUP BY p.dam_id
    ),
    withdrawals AS (
      SELECT t.animal_id, max(t.withdrawal_until) AS withdrawal_until,
        max(t.started_on + t.duration_days + t.withdrawal_milk_days)
          FILTER (WHERE t.withdrawal_milk_days > 0) AS milk_withdrawal_until
      FROM treatment_records t
      WHERE t.farm_id = ${farmId}::uuid AND t.voided_at IS NULL AND t.withdrawal_until IS NOT NULL
      GROUP BY t.animal_id
    ),
    facts AS (
      SELECT a.id AS animal_id,
        a.sex,
        (a.deleted_at IS NULL AND a.exit_type IS NULL) AS is_active,
        COALESCE(va.vaccine_overdue, false) AS vaccine_overdue,
        COALESCE(va.vaccine_due, false) AS vaccine_due,
        wf.last_on AS weight_last_on,
        wf.last_cents AS weight_last_cents,
        wf.prev_cents AS weight_prev_cents,
        wf.gain_last_two_milli,
        wf.gain_90_milli,
        wf.gain_birth_milli,
        hato_months_between(a.birth_date, ${todayDate}) AS age_months,
        COALESCE(r.calving_count, 0) + a.imported_prior_calvings AS calving_count,
        r.last_calving_date,
        r.open_service_date,
        r.open_confirmed_at,
        r.open_expected_calving_date,
        w.withdrawal_until,
        w.milk_withdrawal_until,
        EXISTS (
          SELECT 1 FROM animal_tags at JOIN tags tg ON tg.id = at.tag_id
          WHERE at.animal_id = a.id AND at.removed_at IS NULL
            AND tg.farm_id = ${farmId}::uuid AND tg.key = ${BREEDER_TAG_KEY}
        ) AS is_breeder,
        (r.open_service_date IS NOT NULL AND r.open_confirmed_at IS NULL) AS served,
        (r.open_service_date IS NOT NULL AND r.open_confirmed_at IS NOT NULL) AS pregnant
      FROM animals a
      LEFT JOIN reproduction r ON r.dam_id = a.id
      LEFT JOIN withdrawals w ON w.animal_id = a.id
      LEFT JOIN vaccine_alerts va ON va.animal_id = a.id
      LEFT JOIN weight_facts wf ON wf.animal_id = a.id
      WHERE a.farm_id = ${farmId}::uuid
    ),
    categorized AS (
      SELECT f.*,
        CASE
          WHEN f.sex = ${SEX.FEMALE}::"Sex" THEN
            CASE
              WHEN f.age_months < ${weaningAgeMonths}::int THEN ${MANAGEMENT_CATEGORY.CALF_FEMALE}::text
              WHEN f.calving_count >= 1 THEN ${MANAGEMENT_CATEGORY.COW}::text
              ELSE ${MANAGEMENT_CATEGORY.HEIFER}::text
            END
          ELSE
            CASE
              WHEN f.age_months < ${weaningAgeMonths}::int THEN ${MANAGEMENT_CATEGORY.CALF_MALE}::text
              WHEN f.age_months < ${ADULT_MALE_AGE_MONTHS}::int THEN ${MANAGEMENT_CATEGORY.YOUNG_MALE}::text
              ELSE ${MANAGEMENT_CATEGORY.ADULT_MALE}::text
            END
        END AS category
      FROM facts f
    ),
    targeted AS (
      SELECT k.*,
        ${gainThresholdSql(params)} AS gain_threshold_milli,
        CASE WHEN k.is_active AND NOT k.is_breeder THEN ${saleTargetSql(params)} END AS sale_target_cents
      FROM categorized k
    ),
    classified AS (
      SELECT k.*,
        (k.calving_count >= 1) AS calved,
        (k.category = ${MANAGEMENT_CATEGORY.COW}::text
          AND k.open_service_date IS NULL
          AND k.last_calving_date IS NOT NULL
          AND hato_months_between(k.last_calving_date, ${todayDate}) >= ${weaningAgeMonths}::int) AS dry,
        (k.withdrawal_until IS NOT NULL AND k.withdrawal_until >= ${todayDate}) AS withdrawal,
        (k.pregnant
          AND k.open_expected_calving_date <= ${todayDate} + ${params.calvingAlertDays}::int) AS calving_soon,
        (k.served
          AND (${todayDate} - k.open_service_date) > ${params.unconfirmedServiceAlertDays}::int) AS unconfirmed_service,
        (k.open_service_date IS NOT NULL
          AND (${todayDate} - k.open_expected_calving_date) > ${params.overdueCalvingAlertDays}::int) AS calving_overdue,
        COALESCE(k.is_active AND k.gain_90_milli IS NOT NULL
          AND k.gain_90_milli < k.gain_threshold_milli, false) AS low_gain,
        (k.is_active AND k.milk_withdrawal_until IS NOT NULL
          AND k.milk_withdrawal_until >= ${todayDate}) AS milk_withdrawal,
        CASE WHEN k.sale_target_cents IS NOT NULL AND k.weight_last_cents < k.sale_target_cents
            AND k.gain_90_milli > 0 THEN ${saleEstimate}
        END AS sale_weight_on,
        CASE
          WHEN k.sale_target_cents IS NULL OR k.weight_last_cents IS NULL THEN NULL
          WHEN k.weight_last_cents >= k.sale_target_cents THEN ${SALE_WEIGHT_STATUS.REACHED}::text
          WHEN k.gain_90_milli IS NULL OR k.gain_90_milli <= 0 THEN NULL
          WHEN ${saleEstimate} < ${todayDate} THEN ${SALE_WEIGHT_STATUS.LIKELY_REACHED}::text
          WHEN ${saleEstimate} <= ${monthEnd} THEN ${SALE_WEIGHT_STATUS.THIS_MONTH}::text
          ELSE ${SALE_WEIGHT_STATUS.LATER}::text
        END AS sale_weight_status,
        (k.is_active AND k.weight_prev_cents IS NOT NULL
          AND 100 * (k.weight_prev_cents - k.weight_last_cents)
              > ${params.weightLossAlertPercent}::int * k.weight_prev_cents) AS weight_loss
      FROM targeted k
    )`;
}

/**
 * Columna booleana de cada etiqueta derivada dentro de `classified` (alias `c`). Es una lista
 * cerrada: el filtro `tags` solo puede elegir entre estas expresiones fijas.
 */
export const DERIVED_TAG_COLUMN: Readonly<Record<DerivedTag, Prisma.Sql>> = {
  [DERIVED_TAG.SERVED]: Prisma.sql`c.served`,
  [DERIVED_TAG.PREGNANT]: Prisma.sql`c.pregnant`,
  [DERIVED_TAG.CALVED]: Prisma.sql`c.calved`,
  [DERIVED_TAG.DRY]: Prisma.sql`c.dry`,
  [DERIVED_TAG.WITHDRAWAL]: Prisma.sql`c.withdrawal`,
};

/** Fila cruda de `classified`, tal como la entrega el controlador de PostgreSQL. */
export type ClassifiedRow = {
  readonly animal_id: string;
  readonly age_months: number;
  readonly calving_count: number;
  readonly last_calving_date: Date | null;
  readonly open_service_date: Date | null;
  readonly open_confirmed_at: Date | null;
  readonly open_expected_calving_date: Date | null;
  readonly withdrawal_until: Date | null;
  readonly category: string;
  readonly served: boolean;
  readonly pregnant: boolean;
  readonly calved: boolean;
  readonly dry: boolean;
  readonly withdrawal: boolean;
  readonly calving_soon: boolean;
  readonly unconfirmed_service: boolean;
  readonly calving_overdue: boolean;
  readonly is_active: boolean;
  readonly vaccine_overdue: boolean;
  readonly vaccine_due: boolean;
  readonly weight_last_cents: bigint | null;
  readonly weight_prev_cents: bigint | null;
  readonly gain_last_two_milli: number | null;
  readonly gain_90_milli: number | null;
  readonly gain_birth_milli: number | null;
  readonly low_gain: boolean;
  readonly weight_loss: boolean;
  readonly weight_last_on: Date | null;
  readonly milk_withdrawal_until: Date | null;
  readonly milk_withdrawal: boolean;
  readonly is_breeder: boolean;
  readonly gain_threshold_milli: number | null;
  readonly sale_target_cents: bigint | null;
  readonly sale_weight_on: Date | null;
  readonly sale_weight_status: string | null;
};
