import { CODE_SUGGESTION, suggestCodes, type FarmSettings } from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';

/**
 * Códigos sugeridos de la finca (ANI-10, RN-28), en un solo lugar: los usan `GET /animals/next-code`
 * y el parto (REP-04), que asigna el código de las crías que llegan sin él.
 *
 * - `LOWEST_FREE`: los menores enteros libres del conjunto donde se exige la unicidad (ANI-10 CA2):
 *   los activos si la finca reutiliza números, todos los no archivados si no.
 * - `PATTERN`: consecutivos del patrón de las crías (08 §2.3). Cuentan todos los códigos de la
 *   finca, también los de animales archivados, para no reutilizarlos nunca.
 */
export async function suggestFarmCodes(
  db: Tx,
  scope: FarmScope,
  settings: FarmSettings,
  input: {
    readonly year: number;
    readonly count: number;
    /** Códigos ya elegidos en la misma operación (las otras crías del parto). */
    readonly alsoTaken?: readonly string[];
  },
): Promise<string[]> {
  const lowestFree = settings.codeSuggestion === CODE_SUGGESTION.LOWEST_FREE;
  const rows = await db.animal.findMany({
    where: lowestFree
      ? { farmId: scope.farmId, deletedAt: null, ...(settings.codeReuse ? { exitType: null } : {}) }
      : { farmId: scope.farmId },
    select: { code: true },
  });
  return suggestCodes({
    suggestion: settings.codeSuggestion,
    pattern: settings.calfCodePattern,
    year: input.year,
    existingCodes: [...rows.map((row) => row.code), ...(input.alsoTaken ?? [])],
    count: input.count,
  });
}
