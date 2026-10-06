import {
  WEIGHT_GAIN_MIN_SPAN_DAYS,
  WEIGHT_GAIN_WINDOW_DAYS,
  addDays,
  type IsoDate,
} from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';

/**
 * Ganancia de peso en SQL (PES-02, PES-05; ADR-015, ADR-009).
 *
 * Traducción de `weightGains` de `@hato/shared` para filtrar y contar «Ganancia baja» y «Perdió
 * peso» en la base. La aritmética es la misma y es exacta: kilos en centésimas (`numeric(7,2)` por
 * 100), fechas en días y la pendiente redondeada a milésimas de kg/día mitad lejos de cero con
 * `div`, la división entera exacta de `numeric` (un `floor` sobre una división con decimales
 * podría redondear antes). Por eso la prueba de equivalencia compara las ganancias y las
 * alertas **exactas**, también en los casos justo en el umbral.
 *
 * El orden de los pesajes es fecha y, el mismo día, `id` (UUIDv7, orden de creación), como en
 * shared.
 */

export type WeightGainParams = {
  readonly farmId: string;
  readonly today: IsoDate;
  /** `Farm.settings.weightGainAnchorMaxDays`. */
  readonly anchorMaxDays: number;
};

/**
 * Pendiente de dos puntos en milésimas de kg/día, redondeada mitad lejos de cero:
 * sign(Δc) · ⌊(20·|Δc| + Δd) / (2·Δd)⌋, con `div` (cociente entero exacto de `numeric`).
 */
function twoPointMilli(deltaCents: Prisma.Sql, deltaDays: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(sign(${deltaCents}) * div((20 * abs(${deltaCents}) + ${deltaDays})::numeric, (2 * ${deltaDays})::numeric))::int`;
}

/**
 * CTE `weight_facts`: una fila por animal con al menos un pesaje válido, con `last_on`, `last_cents`,
 * `prev_cents` (el último de una fecha anterior), `gain_last_two_milli`, `gain_90_milli` y
 * `gain_birth_milli`.
 */
export function weightGainCtes(params: WeightGainParams): Prisma.Sql {
  const { farmId } = params;
  const today = Prisma.sql`${params.today}::date`;
  const windowStart = Prisma.sql`${addDays(params.today, -WEIGHT_GAIN_WINDOW_DAYS)}::date`;

  return Prisma.sql`
    wg_valid AS (
      SELECT w.animal_id, w.id, w.weighed_on, round(w.weight_kg * 100)::bigint AS cents,
        w.is_birth_weight
      FROM weight_records w
      WHERE w.farm_id = ${farmId}::uuid AND w.voided_at IS NULL
    ),
    wg_last AS (
      SELECT DISTINCT ON (animal_id) animal_id, weighed_on AS last_on, cents AS last_cents
      FROM wg_valid
      ORDER BY animal_id, weighed_on DESC, id DESC
    ),
    wg_prev AS (
      SELECT DISTINCT ON (v.animal_id) v.animal_id, v.weighed_on AS prev_on, v.cents AS prev_cents
      FROM wg_valid v JOIN wg_last l ON l.animal_id = v.animal_id
      WHERE v.weighed_on < l.last_on
      ORDER BY v.animal_id, v.weighed_on DESC, v.id DESC
    ),
    wg_birth AS (
      SELECT DISTINCT ON (animal_id) animal_id, weighed_on AS birth_on, cents AS birth_cents
      FROM wg_valid
      WHERE is_birth_weight
      ORDER BY animal_id, weighed_on, id
    ),
    wg_anchor AS (
      SELECT DISTINCT ON (animal_id) animal_id, weighed_on, cents
      FROM wg_valid
      WHERE weighed_on < ${windowStart}
      ORDER BY animal_id, weighed_on DESC, id DESC
    ),
    wg_points AS (
      SELECT animal_id, weighed_on, cents, true AS in_window
      FROM wg_valid
      WHERE weighed_on BETWEEN ${windowStart} AND ${today}
      UNION ALL
      SELECT animal_id, weighed_on, cents, false AS in_window
      FROM wg_anchor
      WHERE (${windowStart} - weighed_on) <= ${params.anchorMaxDays}::int
    ),
    wg_sums AS (
      SELECT animal_id,
        count(*) FILTER (WHERE in_window) AS in_window_n,
        count(*)::numeric AS n,
        min(weighed_on) AS first_on,
        max(weighed_on) AS last_on,
        sum(x) AS sx, sum(y) AS sy, sum(x * y) AS sxy, sum(x * x) AS sxx
      FROM (
        SELECT p.animal_id, p.weighed_on, p.in_window,
          (p.weighed_on - min(p.weighed_on) OVER (PARTITION BY p.animal_id))::numeric AS x,
          p.cents::numeric AS y
        FROM wg_points p
      ) q
      GROUP BY animal_id
    ),
    wg_regression AS (
      SELECT animal_id,
        (n * sxy - sx * sy) AS num,
        (n * sxx - sx * sx) AS den
      FROM wg_sums
      WHERE in_window_n >= 1 AND n >= 2
        AND (last_on - first_on) >= ${WEIGHT_GAIN_MIN_SPAN_DAYS}::int
    ),
    weight_facts AS (
      SELECT l.animal_id, l.last_on, l.last_cents, p.prev_cents,
        CASE WHEN p.prev_on IS NOT NULL THEN
          ${twoPointMilli(Prisma.sql`(l.last_cents - p.prev_cents)`, Prisma.sql`(l.last_on - p.prev_on)`)}
        END AS gain_last_two_milli,
        CASE WHEN r.den > 0 THEN
          (sign(r.num) * div(20 * abs(r.num) + r.den, 2 * r.den))::int
        END AS gain_90_milli,
        CASE WHEN b.birth_on IS NOT NULL AND l.last_on > b.birth_on THEN
          ${twoPointMilli(Prisma.sql`(l.last_cents - b.birth_cents)`, Prisma.sql`(l.last_on - b.birth_on)`)}
        END AS gain_birth_milli
      FROM wg_last l
      LEFT JOIN wg_prev p ON p.animal_id = l.animal_id
      LEFT JOIN wg_birth b ON b.animal_id = l.animal_id
      LEFT JOIN wg_regression r ON r.animal_id = l.animal_id
    )`;
}
