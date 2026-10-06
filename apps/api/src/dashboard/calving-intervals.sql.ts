import { CALVING_INTERVAL_BUCKETS, PREGNANCY_OUTCOME } from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';

/**
 * Intervalo entre partos del hato en SQL (M8a, RN-38): la traducción de `herdCalvingIntervals`
 * de shared sobre las hembras **activas**, para no leer todas las preñeces de la finca en la API.
 *
 * Cada parto (preñez `CALVED` no anulada y con fecha) se une con el anterior de la misma madre
 * (`lag`, por fecha y, el mismo día, por id). Un par cuenta solo si ninguno de los dos tiene
 * servicio estimado: no se salta un parto estimado para unir los de sus lados, como
 * `calvingIntervals`. Los partos anteriores importados sin fecha no son preñeces y no entran.
 * La prueba de equivalencia de ADR-009 compara el resultado con shared sobre el seed.
 */
export function herdCalvingIntervalsSql(farmId: string): Prisma.Sql {
  const buckets = CALVING_INTERVAL_BUCKETS.map((bucket) =>
    bucket.toDays === null
      ? Prisma.sql`count(*) FILTER (WHERE days >= ${bucket.fromDays}::int)::int`
      : Prisma.sql`count(*) FILTER (WHERE days >= ${bucket.fromDays}::int AND days < ${bucket.toDays}::int)::int`,
  );
  return Prisma.sql`
    WITH calvings AS (
      SELECT p.dam_id, p.outcome_date, p.service_date_estimated,
        lag(p.outcome_date) OVER w AS prev_date,
        lag(p.service_date_estimated) OVER w AS prev_estimated
      FROM pregnancies p
      JOIN animals a ON a.id = p.dam_id
      WHERE p.farm_id = ${farmId}::uuid AND a.farm_id = ${farmId}::uuid
        AND p.voided_at IS NULL
        AND p.outcome = ${PREGNANCY_OUTCOME.CALVED}::"PregnancyOutcome"
        AND p.outcome_date IS NOT NULL
        AND a.deleted_at IS NULL AND a.exit_type IS NULL
      WINDOW w AS (PARTITION BY p.dam_id ORDER BY p.outcome_date, p.id)
    ),
    intervals AS (
      SELECT dam_id, (outcome_date - prev_date) AS days
      FROM calvings
      WHERE prev_date IS NOT NULL AND NOT service_date_estimated AND NOT prev_estimated
    )
    SELECT count(*)::int AS count,
      count(DISTINCT dam_id)::int AS females,
      round(avg(days))::int AS average_days,
      ARRAY[${Prisma.join(buckets, ', ')}] AS distribution
    FROM intervals`;
}

/** Fila de `herdCalvingIntervalsSql`. */
export type HerdCalvingIntervalsRow = {
  readonly count: number;
  readonly females: number;
  readonly average_days: number | null;
  readonly distribution: number[];
};
