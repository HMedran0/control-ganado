import {
  ADULT_MALE_AGE_MONTHS,
  DERIVED_TAG,
  MANAGEMENT_CATEGORY,
  PREGNANCY_OUTCOME,
  SEX,
  type DerivedTag,
  type IsoDate,
} from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';

/**
 * Clasificación de los animales en SQL (RN-06, RN-07, RN-08, RN-25; docs/adr/009).
 *
 * Es la traducción de `managementCategory`, `derivedTags`, `isCalvingSoon` e
 * `isServiceUnconfirmedOverdue` de `@hato/shared` a una CTE, para poder **filtrar y contar**
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
};

const outcome = (value: string): Prisma.Sql => Prisma.sql`${value}::"PregnancyOutcome"`;

/**
 * CTE `classified`, una fila por animal de la finca (de cualquier estado), con:
 *
 * - `animal_id`, `age_months`;
 * - hechos crudos: `calving_count`, `last_calving_date`, `open_service_date`,
 *   `open_confirmed_at`, `open_expected_calving_date`, `withdrawal_until`;
 * - derivados: `category`, `served`, `pregnant`, `calved`, `dry`, `withdrawal`,
 *   `calving_soon`, `unconfirmed_service`.
 *
 * Se usa como `WITH ${classificationCtes(params)} SELECT … FROM classified c …`.
 */
export function classificationCtes(params: ClassificationParams): Prisma.Sql {
  const { farmId, today, weaningAgeMonths } = params;
  const todayDate = Prisma.sql`${today}::date`;

  return Prisma.sql`
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
      SELECT t.animal_id, max(t.withdrawal_until) AS withdrawal_until
      FROM treatment_records t
      WHERE t.farm_id = ${farmId}::uuid AND t.voided_at IS NULL AND t.withdrawal_until IS NOT NULL
      GROUP BY t.animal_id
    ),
    facts AS (
      SELECT a.id AS animal_id,
        a.sex,
        hato_months_between(a.birth_date, ${todayDate}) AS age_months,
        COALESCE(r.calving_count, 0) AS calving_count,
        r.last_calving_date,
        r.open_service_date,
        r.open_confirmed_at,
        r.open_expected_calving_date,
        w.withdrawal_until,
        (r.open_service_date IS NOT NULL AND r.open_confirmed_at IS NULL) AS served,
        (r.open_service_date IS NOT NULL AND r.open_confirmed_at IS NOT NULL) AS pregnant
      FROM animals a
      LEFT JOIN reproduction r ON r.dam_id = a.id
      LEFT JOIN withdrawals w ON w.animal_id = a.id
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
          AND (${todayDate} - k.open_service_date) > ${params.unconfirmedServiceAlertDays}::int) AS unconfirmed_service
      FROM categorized k
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
};
