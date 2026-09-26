import { DomainError } from '@hato/shared';

import type { FarmScope } from './farm-scope/farm-scope.types.js';

/**
 * Filtro por finca obligatorio para toda consulta de negocio (CLAUDE.md, regla 1;
 * 04-arquitectura.md §4: «todo repositorio lo recibe obligatoriamente»).
 *
 * Los repositorios de M1 en adelante construyen su `where` con `farmFilter(scope)`, de modo
 * que olvidar el filtro sea imposible por construcción y no cuestión de disciplina: la
 * función exige el ámbito y falla si llega vacío.
 */

/** `where` mínimo de cualquier consulta de negocio. */
export type FarmFilter = { readonly farmId: string };

/**
 * Filtro por finca a partir del ámbito de la petición.
 *
 * @throws {DomainError} `FORBIDDEN_ROLE` si el ámbito no trae una finca válida. Es un error de
 *   programación (falta el guard), y se prefiere fallar a devolver datos sin filtrar.
 */
export function farmFilter(scope: FarmScope | undefined): FarmFilter {
  if (scope === undefined || scope.farmId === '') {
    throw new DomainError('FORBIDDEN_ROLE', {
      detail: 'La consulta no tiene una finca asociada.',
    });
  }
  return { farmId: scope.farmId };
}

/**
 * Combina el filtro por finca con el resto del `where`.
 *
 * El `farmId` va al final para que un filtro del cliente no pueda sobrescribirlo: ni con un
 * `farmId` en el cuerpo de la petición.
 */
export function scopedWhere<TWhere extends object>(
  scope: FarmScope | undefined,
  where: TWhere,
): TWhere & FarmFilter {
  return { ...where, ...farmFilter(scope) };
}

/** Filtro de entidades activas: no archivadas (RN-11). */
export function activeWhere<TWhere extends object>(
  scope: FarmScope | undefined,
  where: TWhere = {} as TWhere,
): TWhere & FarmFilter & { deletedAt: null } {
  return { ...scopedWhere(scope, where), deletedAt: null };
}
