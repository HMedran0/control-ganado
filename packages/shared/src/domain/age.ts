/**
 * Edad y grupos de edad. La edad se calcula siempre, nunca se almacena (RN-16).
 * Convención de meses cumplidos con recorte a fin de mes: docs/adr/002-fechas-de-negocio.md.
 */

import {
  daysBetween,
  isoDateFromParts,
  isoDateParts,
  lastDayOfMonth,
  type IsoDate,
} from '../date.js';
import { ICA_AGE_GROUP, SEX, type IcaAgeGroup, type Sex } from '../enums.js';

/**
 * Meses cumplidos entre dos fechas. Negativo si `to` es anterior a `from`.
 *
 * Si el mes de destino no tiene el día de origen, el mes se cumple su último día:
 * del 31/01/2026 al 28/02/2026 hay 1 mes.
 */
export function monthsBetween(from: IsoDate, to: IsoDate): number {
  if (to < from) {
    const forward = monthsBetween(to, from);
    // Sin `-0`: un mes de diferencia cero es cero en cualquier sentido.
    return forward === 0 ? 0 : -forward;
  }

  const start = isoDateParts(from);
  const end = isoDateParts(to);
  const rawMonths = (end.year - start.year) * 12 + (end.month - start.month);

  // El mes está cumplido si ya se alcanzó el día de origen, recortado al último día del mes.
  const dayInTargetMonth = Math.min(start.day, lastDayOfMonth(end.year, end.month));
  return end.day >= dayInTargetMonth ? rawMonths : rawMonths - 1;
}

/** Días cumplidos desde el nacimiento. Negativo si `today` es anterior al nacimiento. */
export function ageInDays(birthDate: IsoDate, today: IsoDate): number {
  return daysBetween(birthDate, today);
}

/**
 * Meses cumplidos desde el nacimiento.
 *
 * No valida que `today` sea posterior al nacimiento: esa es la regla RN-14 y la aplica la
 * capa de la API al registrar eventos. Aquí un valor negativo se propaga tal cual.
 */
export function ageInMonths(birthDate: IsoDate, today: IsoDate): number {
  return monthsBetween(birthDate, today);
}

/** Años cumplidos desde el nacimiento. */
export function ageInYears(birthDate: IsoDate, today: IsoDate): number {
  return Math.floor(ageInMonths(birthDate, today) / 12);
}

/**
 * Grupo de edad del reporte ICA (08 §2.2).
 *
 * Hembras: < 3 m · 3–9 m · 9–12 m · 1–2 a · 2–3 a · 3–5 a · > 5 a.
 * Machos: < 3 m · 3–9 m · 9–12 m · 1–2 a · 2–3 a · > 3 a.
 * Los límites son inferiores inclusivos: 9 meses cumplidos ya es `M9_TO_12`.
 */
export function icaAgeGroup(sex: Sex, ageMonths: number): IcaAgeGroup {
  if (ageMonths < 3) return ICA_AGE_GROUP.UNDER_3M;
  if (ageMonths < 9) return ICA_AGE_GROUP.M3_TO_9;
  if (ageMonths < 12) return ICA_AGE_GROUP.M9_TO_12;
  if (ageMonths < 24) return ICA_AGE_GROUP.Y1_TO_2;

  if (sex === SEX.MALE) {
    return ageMonths < 36 ? ICA_AGE_GROUP.Y2_TO_3 : ICA_AGE_GROUP.OVER_3Y;
  }

  if (ageMonths < 36) return ICA_AGE_GROUP.Y2_TO_3;
  return ageMonths < 60 ? ICA_AGE_GROUP.Y3_TO_5 : ICA_AGE_GROUP.OVER_5Y;
}

/** Grupo de edad del ICA a partir de la fecha de nacimiento. */
export function icaAgeGroupFor(sex: Sex, birthDate: IsoDate, today: IsoDate): IcaAgeGroup {
  return icaAgeGroup(sex, ageInMonths(birthDate, today));
}

/**
 * Nacimientos que cumplen la edad de destete en el mes de `date` (CFG-03, pregunta de cría
 * «¿Cuántos terneros se destetan este mes?»).
 *
 * Con meses cumplidos y recorte a fin de mes (ADR-002), quien nace en el mes M − W cumple W meses
 * dentro del mes M (el 31 de enero cumple un mes el 28 de febrero), y nadie más lo hace. Así que
 * el rango es el mes calendario completo, W meses antes: del primero al último día.
 */
export function weaningBirthRange(
  date: IsoDate,
  weaningAgeMonths: number,
): { readonly from: IsoDate; readonly to: IsoDate } {
  const { year, month } = isoDateParts(date);
  const index = year * 12 + (month - 1) - weaningAgeMonths;
  const birthYear = Math.floor(index / 12);
  const birthMonth = (index % 12) + 1;
  return {
    from: isoDateFromParts(birthYear, birthMonth, 1),
    to: isoDateFromParts(birthYear, birthMonth, lastDayOfMonth(birthYear, birthMonth)),
  };
}
