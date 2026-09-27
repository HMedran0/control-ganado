import { AUDIT_ACTION, DomainError } from '@hato/shared';

import { isUniqueViolation } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';

export { assertVersion, audit, changesBetween, type Tx } from '../common/persistence.js';

/**
 * Piezas de los catálogos (M3): traducción de los choques de nombre. La auditoría, la versión y
 * el diff viven en `common/persistence.ts` y se reexportan aquí.
 */

/** Artículo y nombre de cada catálogo, para el mensaje de `CATALOG_NAME_TAKEN`. */
export const CATALOG_WHAT = {
  Breed: 'una raza',
  Vaccine: 'una vacuna',
  VaccinationCycle: 'un ciclo',
  Lot: 'un lote',
  Tag: 'una etiqueta',
} as const;

export type CatalogEntity = keyof typeof CATALOG_WHAT | 'Farm';

/**
 * Ejecuta una escritura de catálogo y traduce los errores de la base al catálogo de errores:
 *
 * - un nombre repetido (P2002) → `CATALOG_NAME_TAKEN`. La unicidad sin distinguir mayúsculas la
 *   garantiza la base (índice sobre `lower(name)`), no una consulta previa: así no hay carrera
 *   entre dos personas que crean «Brahman» a la vez;
 * - un `update` con `where: { version }` que no encontró la fila (P2025) → `VERSION_CONFLICT`:
 *   otra persona la cambió entre la lectura y la escritura.
 */
export async function catalogWrite<T>(
  entity: CatalogEntity,
  name: string | undefined,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error) && entity !== 'Farm') {
      throw new DomainError('CATALOG_NAME_TAKEN', {
        params: { what: CATALOG_WHAT[entity], name: name ?? '' },
        cause: error,
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new DomainError('VERSION_CONFLICT', { cause: error });
    }
    throw error;
  }
}

export { AUDIT_ACTION };

/** `?includeInactive=true` en los listados. */
export function parseIncludeInactive(value: string | undefined): boolean {
  return value === 'true';
}
