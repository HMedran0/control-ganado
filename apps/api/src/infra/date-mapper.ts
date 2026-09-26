import { isoDateFromInstant, isoDateParts, type IsoDate } from '@hato/shared';

/**
 * Conversión entre las fechas de negocio de `@hato/shared` (`IsoDate`, sin hora ni zona) y
 * las columnas `date` de PostgreSQL, que Prisma entrega y recibe como `Date` de JavaScript.
 *
 * Es el **único** lugar del proyecto donde ocurre esa conversión (ADR-002). Prisma representa
 * una columna `date` como el instante de medianoche **UTC** de ese día, así que la ida y la
 * vuelta se hacen siempre en UTC: si se usaran los captadores locales, en Bogotá (UTC−5) el
 * 1 de marzo se leería como 28 de febrero.
 */

/** `IsoDate` → `Date` de medianoche UTC, para escribir en una columna `date`. */
export function toPrismaDate(date: IsoDate): Date {
  const { year, month, day } = isoDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/** `Date` de una columna `date` → `IsoDate`, leyendo el día en UTC. */
export function fromPrismaDate(value: Date): IsoDate {
  return isoDateFromInstant(value, 'UTC');
}

/** Igual que `toPrismaDate`, aceptando nulos. */
export function toPrismaDateOrNull(date: IsoDate | null | undefined): Date | null {
  return date === null || date === undefined ? null : toPrismaDate(date);
}

/** Igual que `fromPrismaDate`, aceptando nulos. */
export function fromPrismaDateOrNull(value: Date | null | undefined): IsoDate | null {
  return value === null || value === undefined ? null : fromPrismaDate(value);
}
