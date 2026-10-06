import {
  VACCINE_SCHEDULE_TYPE,
  VACCINE_STATUS,
  VACCINE_STATUS_REASON,
  type IsoDate,
} from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';

/**
 * Estado de las vacunas en SQL (RN-13, ADR-004; ADR-009 decisión 8, M6).
 *
 * Es la traducción de `vaccineStatus` de `@hato/shared` —los cuatro tipos de programación, con
 * los ciclos oficiales en curso y cerrados— para **filtrar y contar** las alertas de vacunas en la
 * base (listado, página de Alertas, avance de un ciclo). La ficha y cada fila siguen mostrando lo
 * que calcula shared; la prueba de equivalencia de ADR-009 compara estado, motivo y fecha límite
 * animal por animal y vacuna por vacuna.
 *
 * Como en `classification.sql.ts`, todo valor entra como parámetro: hoy, la ventana de alerta de
 * la finca y los códigos de tipo, estado y motivo.
 */

export type VaccineStatusParams = {
  readonly farmId: string;
  readonly today: IsoDate;
  /** `Farm.settings.vaccineAlertDays`. */
  readonly vaccineAlertDays: number;
};

const text = (value: string): Prisma.Sql => Prisma.sql`${value}::text`;
const schedule = (value: string): Prisma.Sql => Prisma.sql`${value}::"VaccineScheduleType"`;

/**
 * CTE `vaccine_status`: una fila por animal **activo** y vacuna activa con programación, con
 * `kind` (`VACCINE_STATUS`), `reason` (`VACCINE_STATUS_REASON`) y `due_on`.
 *
 * - Ciclo en curso: el ciclo oficial activo que contiene hoy y tiene la vacuna vigente, el de
 *   inicio más reciente; último cerrado: el de fin más reciente antes de hoy (`cyclesAt`).
 * - Última aplicación: la de fecha más reciente; el mismo día, la de próxima fecha más lejana.
 * - En la finca desde: el nacimiento si el ingreso es estimado; si no, el máximo de los dos.
 */
export function vaccineStatusCtes(params: VaccineStatusParams): Prisma.Sql {
  const { farmId } = params;
  const today = Prisma.sql`${params.today}::date`;
  const S = VACCINE_STATUS;
  const R = VACCINE_STATUS_REASON;

  return Prisma.sql`
    vs_vaccines AS (
      SELECT v.id, v.schedule_type, v.booster_interval_days, v.eligible_sex,
        v.min_age_days, v.max_age_days
      FROM vaccines v
      WHERE v.farm_id = ${farmId}::uuid AND v.is_active
        AND v.schedule_type <> ${schedule(VACCINE_SCHEDULE_TYPE.NONE)}
    ),
    vs_cycle_links AS (
      SELECT cv.vaccine_id, cy.starts_on, cy.ends_on
      FROM vaccination_cycle_vaccines cv
      JOIN vaccination_cycles cy ON cy.id = cv.cycle_id
      WHERE cv.farm_id = ${farmId}::uuid AND cv.removed_at IS NULL
        AND cy.is_active AND cy.is_official
    ),
    vs_current AS (
      SELECT DISTINCT ON (vaccine_id) vaccine_id, starts_on, ends_on
      FROM vs_cycle_links
      WHERE ${today} BETWEEN starts_on AND ends_on
      ORDER BY vaccine_id, starts_on DESC
    ),
    vs_closed AS (
      SELECT DISTINCT ON (vaccine_id) vaccine_id, starts_on, ends_on
      FROM vs_cycle_links
      WHERE ends_on < ${today}
      ORDER BY vaccine_id, ends_on DESC
    ),
    vs_records AS (
      SELECT r.animal_id, r.vaccine_id, r.applied_on, r.next_due_on
      FROM vaccination_records r
      WHERE r.farm_id = ${farmId}::uuid AND r.voided_at IS NULL
    ),
    vs_last AS (
      SELECT DISTINCT ON (animal_id, vaccine_id) animal_id, vaccine_id, applied_on, next_due_on
      FROM vs_records
      ORDER BY animal_id, vaccine_id, applied_on DESC, next_due_on DESC NULLS LAST
    ),
    vs_pairs AS (
      SELECT a.id AS animal_id, v.id AS vaccine_id, v.schedule_type, v.booster_interval_days,
        v.min_age_days, v.max_age_days,
        (v.eligible_sex IS NULL OR v.eligible_sex = a.sex) AS sex_ok,
        a.birth_date,
        (${today} - a.birth_date) AS age_days,
        CASE WHEN a.entry_date_estimated THEN a.birth_date
             ELSE GREATEST(a.birth_date, a.entry_date) END AS in_farm_since,
        COALESCE(cur.starts_on, clo.starts_on) AS cycle_starts_on,
        COALESCE(cur.ends_on, clo.ends_on) AS cycle_ends_on,
        (cur.vaccine_id IS NOT NULL) AS cycle_is_current,
        l.applied_on AS last_applied_on,
        COALESCE(l.next_due_on,
          CASE WHEN v.booster_interval_days > 0
               THEN l.applied_on + v.booster_interval_days END) AS interval_due_on,
        -- Sobre la tabla y no sobre vs_records: la CTE no tiene índice y el EXISTS la recorría
        -- por cada par animal-vacuna (M8a, medido con el seed de carga). Mismo filtro que
        -- vs_records; el índice (farm_id, animal_id, vaccine_id, applied_on) lo resuelve.
        EXISTS (
          SELECT 1 FROM vaccination_records r
          WHERE r.farm_id = ${farmId}::uuid AND r.voided_at IS NULL
            AND r.animal_id = a.id AND r.vaccine_id = v.id
            AND r.applied_on BETWEEN COALESCE(cur.starts_on, clo.starts_on)
                                 AND COALESCE(cur.ends_on, clo.ends_on)) AS cycle_applied
      FROM animals a
      CROSS JOIN vs_vaccines v
      LEFT JOIN vs_current cur ON cur.vaccine_id = v.id
      LEFT JOIN vs_closed clo ON clo.vaccine_id = v.id AND cur.vaccine_id IS NULL
      LEFT JOIN vs_last l ON l.animal_id = a.id AND l.vaccine_id = v.id
      WHERE a.farm_id = ${farmId}::uuid AND a.deleted_at IS NULL AND a.exit_type IS NULL
    ),
    vaccine_status AS (
      SELECT p.animal_id, p.vaccine_id, s.kind, s.reason, s.due_on
      FROM vs_pairs p
      CROSS JOIN LATERAL (
        SELECT
          CASE
            WHEN NOT p.sex_ok THEN ${text(S.NOT_APPLICABLE)}
            WHEN p.schedule_type = ${schedule(VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE)} THEN
              CASE
                WHEN p.cycle_ends_on IS NULL THEN ${text(S.NOT_APPLICABLE)}
                WHEN p.in_farm_since > p.cycle_ends_on THEN ${text(S.NOT_APPLICABLE)}
                WHEN p.cycle_applied
                  THEN ${text(S.UP_TO_DATE)}
                WHEN p.cycle_is_current THEN ${text(S.PENDING)}
                ELSE ${text(S.OVERDUE)}
              END
            WHEN p.schedule_type = ${schedule(VACCINE_SCHEDULE_TYPE.AGE_WINDOW)} THEN
              CASE
                WHEN p.last_applied_on IS NOT NULL THEN ${text(S.UP_TO_DATE)}
                WHEN p.min_age_days IS NOT NULL AND p.age_days < p.min_age_days
                  THEN ${text(S.NOT_APPLICABLE)}
                WHEN p.max_age_days IS NOT NULL AND p.age_days > p.max_age_days
                  THEN ${text(S.OVERDUE)}
                ELSE ${text(S.PENDING)}
              END
            ELSE
              CASE
                WHEN p.last_applied_on IS NULL THEN
                  CASE WHEN p.min_age_days IS NOT NULL AND p.age_days < p.min_age_days
                       THEN ${text(S.NOT_APPLICABLE)} ELSE ${text(S.PENDING)} END
                WHEN p.interval_due_on IS NULL THEN ${text(S.UP_TO_DATE)}
                WHEN p.interval_due_on < ${today} THEN ${text(S.OVERDUE)}
                WHEN p.interval_due_on <= ${today} + ${params.vaccineAlertDays}::int
                  THEN ${text(S.UPCOMING)}
                ELSE ${text(S.UP_TO_DATE)}
              END
          END,
          CASE
            WHEN NOT p.sex_ok THEN ${text(R.NOT_ELIGIBLE_SEX)}
            WHEN p.schedule_type = ${schedule(VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE)} THEN
              CASE
                WHEN p.cycle_ends_on IS NULL THEN ${text(R.NO_CYCLE)}
                WHEN p.in_farm_since > p.cycle_ends_on THEN ${text(R.NOT_IN_FARM_DURING_CYCLE)}
                WHEN p.cycle_applied
                  THEN ${text(R.APPLIED)}
                WHEN p.cycle_is_current THEN ${text(R.CURRENT_CYCLE)}
                ELSE ${text(R.CLOSED_CYCLE)}
              END
            WHEN p.schedule_type = ${schedule(VACCINE_SCHEDULE_TYPE.AGE_WINDOW)} THEN
              CASE
                WHEN p.last_applied_on IS NOT NULL THEN ${text(R.APPLIED)}
                WHEN p.min_age_days IS NOT NULL AND p.age_days < p.min_age_days
                  THEN ${text(R.BEFORE_AGE_WINDOW)}
                WHEN p.max_age_days IS NOT NULL AND p.age_days > p.max_age_days
                  THEN ${text(R.AFTER_AGE_WINDOW)}
                ELSE ${text(R.IN_AGE_WINDOW)}
              END
            ELSE
              CASE
                WHEN p.last_applied_on IS NULL THEN
                  CASE WHEN p.min_age_days IS NOT NULL AND p.age_days < p.min_age_days
                       THEN ${text(R.BEFORE_AGE_WINDOW)} ELSE ${text(R.NO_RECORD)} END
                WHEN p.interval_due_on IS NULL THEN ${text(R.APPLIED)}
                WHEN p.interval_due_on < ${today} THEN ${text(R.INTERVAL_ELAPSED)}
                WHEN p.interval_due_on <= ${today} + ${params.vaccineAlertDays}::int
                  THEN ${text(R.INTERVAL_NEAR)}
                ELSE ${text(R.APPLIED)}
              END
          END,
          CASE
            WHEN NOT p.sex_ok THEN NULL::date
            WHEN p.schedule_type = ${schedule(VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE)} THEN
              CASE
                WHEN p.cycle_ends_on IS NULL OR p.in_farm_since > p.cycle_ends_on THEN NULL::date
                WHEN p.cycle_applied
                  THEN NULL::date
                ELSE p.cycle_ends_on
              END
            WHEN p.schedule_type = ${schedule(VACCINE_SCHEDULE_TYPE.AGE_WINDOW)} THEN
              CASE
                WHEN p.last_applied_on IS NOT NULL THEN NULL::date
                WHEN p.min_age_days IS NOT NULL AND p.age_days < p.min_age_days
                  THEN p.birth_date + p.min_age_days
                ELSE p.birth_date + p.max_age_days
              END
            ELSE
              CASE
                WHEN p.last_applied_on IS NULL THEN
                  CASE WHEN p.min_age_days IS NOT NULL AND p.age_days < p.min_age_days
                       THEN p.birth_date + p.min_age_days END
                ELSE p.interval_due_on
              END
          END
      ) AS s(kind, reason, due_on)
    ),
    vaccine_alerts AS (
      SELECT animal_id,
        bool_or(kind = ${text(S.OVERDUE)}) AS vaccine_overdue,
        bool_or(kind IN (${text(S.PENDING)}, ${text(S.UPCOMING)})) AS vaccine_due
      FROM vaccine_status
      GROUP BY animal_id
    )`;
}

/** Fila cruda de `vaccine_status`. */
export type VaccineStatusRow = {
  readonly animal_id: string;
  readonly vaccine_id: string;
  readonly kind: string;
  readonly reason: string;
  readonly due_on: Date | null;
};
