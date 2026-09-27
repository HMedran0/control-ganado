/** Estado del animal en el inventario (CLS-03, ANI-03, RN-11). */

import { ANIMAL_STATUS, EXIT_TYPE, type AnimalStatus, type ExitType } from '../enums.js';

/** Entrada de `animalStatus`. */
export type AnimalStatusInput = {
  /** `deleted_at IS NOT NULL`. */
  readonly archived: boolean;
  /** `exit_type`; `null` si sigue en la finca. */
  readonly exitType: ExitType | null;
};

/**
 * Estado del animal: archivado, vendido (salida por venta), retirado (cualquier otra salida) o
 * activo. Un animal activo es el que no está archivado ni tiene salida (03 §4).
 */
export function animalStatus(input: AnimalStatusInput): AnimalStatus {
  if (input.archived) return ANIMAL_STATUS.ARCHIVED;
  if (input.exitType === null) return ANIMAL_STATUS.ACTIVE;
  return input.exitType === EXIT_TYPE.SALE ? ANIMAL_STATUS.SOLD : ANIMAL_STATUS.RETIRED;
}
