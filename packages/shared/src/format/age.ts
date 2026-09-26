/**
 * Edad legible (ANI-08 CA2): menos de un mes en días, menos de dos años en meses y
 * desde ahí «X a Y m». Si la fecha de nacimiento es aproximada se antepone «≈».
 */

import { type IsoDate } from '../date.js';
import { ageInDays, ageInMonths } from '../domain/age.js';

/** Entrada de `formatAge`. */
export type FormatAgeInput = {
  readonly birthDate: IsoDate;
  readonly today: IsoDate;
  /** `Animal.birthDateEstimated`. Antepone «≈» al resultado. */
  readonly estimated?: boolean;
};

/** Edad en texto: `18 días`, `7 meses`, `3 a 4 m`, `≈ 3 a 4 m`. */
export function formatAge(input: FormatAgeInput): string {
  const months = ageInMonths(input.birthDate, input.today);
  const prefix = input.estimated === true ? '≈ ' : '';

  if (months < 1) {
    const days = ageInDays(input.birthDate, input.today);
    return `${prefix}${days} ${days === 1 ? 'día' : 'días'}`;
  }

  if (months < 24) {
    return `${prefix}${months} ${months === 1 ? 'mes' : 'meses'}`;
  }

  const years = Math.floor(months / 12);
  return `${prefix}${years} a ${months % 12} m`;
}
