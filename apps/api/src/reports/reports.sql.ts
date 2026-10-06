import { ICA_AGE_GROUP, SEX } from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';

/**
 * Grupo de edad del ICA (08 §2.2) en SQL: la misma regla que `icaAgeGroup` de shared, sobre la
 * edad en meses cumplidos que ya calcula `classified` (`age_months`). Una prueba de equivalencia
 * compara animal por animal sobre el seed (ADR-009).
 */
export function icaAgeGroupSql(sex: Prisma.Sql, ageMonths: Prisma.Sql): Prisma.Sql {
  const G = ICA_AGE_GROUP;
  return Prisma.sql`CASE
    WHEN ${ageMonths} < 3 THEN ${G.UNDER_3M}::text
    WHEN ${ageMonths} < 9 THEN ${G.M3_TO_9}::text
    WHEN ${ageMonths} < 12 THEN ${G.M9_TO_12}::text
    WHEN ${ageMonths} < 24 THEN ${G.Y1_TO_2}::text
    WHEN ${ageMonths} < 36 THEN ${G.Y2_TO_3}::text
    WHEN ${sex} = ${SEX.MALE}::"Sex" THEN ${G.OVER_3Y}::text
    WHEN ${ageMonths} < 60 THEN ${G.Y3_TO_5}::text
    ELSE ${G.OVER_5Y}::text
  END`;
}

/**
 * ¿El animal (alias `a`) estaba en la finca al terminar el día `day`? La regla de `wasInHerdOn`
 * de shared: entró ese día o antes, no había salido (el día de la salida ya no cuenta) y no está
 * archivado.
 */
export function inHerdOnSql(day: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(a.deleted_at IS NULL AND a.entry_date <= ${day}
    AND (a.exit_date IS NULL OR a.exit_date > ${day}))`;
}
