import { Prisma } from '../generated/prisma/client.js';

/**
 * CTE `investment`: inversión por animal en SQL (RN-18), una fila por animal con asignaciones
 * vigentes: `animal_id`, `total` (`numeric`) y `lines` (cuántas asignaciones). Es el mismo cálculo
 * que `animalInvestment` de shared y lo comprueba la prueba de equivalencia de ADR-009, animal
 * por animal sobre el seed. Una asignación cuenta si ni ella ni su gasto están anulados.
 *
 * Se usa como `WITH ${investmentCte(farmId)} SELECT … FROM investment i …`.
 */
export function investmentCte(farmId: string): Prisma.Sql {
  return Prisma.sql`
    investment AS (
      SELECT ea.animal_id, sum(ea.amount) AS total, count(*)::int AS lines
        FROM expense_allocations ea
        JOIN expenses e ON e.id = ea.expense_id
       WHERE ea.farm_id = ${farmId}::uuid
         AND e.farm_id = ${farmId}::uuid
         AND ea.voided_at IS NULL
         AND e.voided_at IS NULL
       GROUP BY ea.animal_id
    )`;
}
