/** Formato de fechas para la interfaz: `dd/mm/aaaa` (RNF-13, SRS §2 R1). */

import { isoDateParts, type IsoDate } from '../date.js';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-09-26` → `26/09/2026`. */
export function formatDate(date: IsoDate): string {
  const { year, month, day } = isoDateParts(date);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

/** Igual que `formatDate`, pero devuelve una raya para las fechas ausentes. */
export function formatOptionalDate(date: IsoDate | null | undefined, fallback = '—'): string {
  return date === null || date === undefined ? fallback : formatDate(date);
}
