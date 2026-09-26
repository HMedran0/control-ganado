/**
 * Gestación y fecha estimada de parto (RN-04, 08 §1.4).
 *
 * `expectedCalvingDate` es la única excepción a «los derivados no se almacenan» (RN-16):
 * se guarda en `pregnancies.expected_calving_date` para poder indexar y ordenar los partos
 * próximos, y se recalcula si cambia la fecha de servicio.
 */

import { addDays, type IsoDate } from '../date.js';
import { DomainError } from '../errors.js';
import { BREED_GROUP, type BreedGroup } from '../enums.js';

/**
 * Gestación por defecto de cada grupo racial, en días (08 §1.4).
 * La usa el seed al crear las razas; en tiempo de ejecución manda `Breed.gestationDays`.
 */
export const DEFAULT_GESTATION_DAYS_BY_GROUP = {
  [BREED_GROUP.INDICUS]: 293,
  [BREED_GROUP.TAURUS]: 283,
  [BREED_GROUP.CROSS]: 288,
} as const satisfies Record<BreedGroup, number>;

/** Gestación por defecto de la finca, en días (`Farm.settings.gestationDays`). */
export const DEFAULT_FARM_GESTATION_DAYS = 285;

/** Gestación por defecto de un grupo racial. */
export function defaultGestationDaysForGroup(group: BreedGroup): number {
  return DEFAULT_GESTATION_DAYS_BY_GROUP[group];
}

/** Entrada de `gestationDaysFor`. */
export type GestationDaysInput = {
  /** `Breed.gestationDays` de la raza de la madre; `null` si la raza no tiene valor. */
  readonly breedGestationDays: number | null;
  /** `Farm.settings.gestationDays`. */
  readonly farmGestationDays: number;
};

/**
 * Días de gestación aplicables: los de la raza de la madre o, si no tiene, los de la finca
 * (RN-04 al pie de la letra).
 *
 * @throws {DomainError} `VALIDATION_FAILED` si el valor aplicable no es un entero positivo.
 */
export function gestationDaysFor(input: GestationDaysInput): number {
  const days = input.breedGestationDays ?? input.farmGestationDays;
  if (!Number.isInteger(days) || days <= 0) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `Los días de gestación deben ser un número entero positivo; se recibió «${days}».`,
    });
  }
  return days;
}

/** Entrada de `expectedCalvingDate`. */
export type ExpectedCalvingDateInput = GestationDaysInput & {
  readonly serviceDate: IsoDate;
};

/** Fecha estimada de parto = fecha de servicio + días de gestación aplicables (RN-04). */
export function expectedCalvingDate(input: ExpectedCalvingDateInput): IsoDate {
  return addDays(input.serviceDate, gestationDaysFor(input));
}
