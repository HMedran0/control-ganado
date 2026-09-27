/**
 * Fechas de negocio: cadenas `YYYY-MM-DD` con tipo marcado, sin hora ni zona.
 * Justificación y convención de meses cumplidos: docs/adr/002-fechas-de-negocio.md.
 *
 * La aritmética usa `Date.UTC` como calculadora de calendario. Nunca se construye una fecha
 * desde la hora local ni se consulta el instante actual, así que el resultado no depende
 * de la variable TZ del proceso.
 */

import { DomainError } from './errors.js';

declare const isoDateBrand: unique symbol;

/** Fecha de negocio en formato `YYYY-MM-DD`. Se construye con `toIsoDate` o `isoDateFromParts`. */
export type IsoDate = string & { readonly [isoDateBrand]: true };

/** Partes de una fecha. `month` va de 1 a 12. */
export type IsoDateParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** ¿El año es bisiesto según el calendario gregoriano? */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Último día del mes indicado. `month` va de 1 a 12. */
export function lastDayOfMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= lastDayOfMonth(year, month);
}

/** ¿El valor es una fecha `YYYY-MM-DD` que existe en el calendario? */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return false;
  return isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Valida una cadena y la marca como fecha de negocio.
 * @throws {DomainError} `VALIDATION_FAILED` si no es una fecha `YYYY-MM-DD` real.
 */
export function toIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `La fecha «${value}» no tiene el formato AAAA-MM-DD o no existe en el calendario.`,
    });
  }
  return value;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/**
 * Construye una fecha a partir de sus partes. `month` va de 1 a 12.
 * @throws {DomainError} `VALIDATION_FAILED` si la combinación no existe (31 de febrero).
 */
export function isoDateFromParts(year: number, month: number, day: number): IsoDate {
  if (!isCalendarDate(year, month, day)) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `La fecha ${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)} no existe en el calendario.`,
    });
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as IsoDate;
}

/** Descompone la fecha. `month` va de 1 a 12. */
export function isoDateParts(date: IsoDate): IsoDateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/**
 * Un formateador por zona horaria. Crear un `Intl.DateTimeFormat` cuesta del orden de 100 µs
 * y la API convierte decenas de miles de fechas por consulta (las alertas de vacunas de 5.000
 * animales pasaban de 4 s sin esta caché); formatear con uno ya creado es casi gratis.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Día del calendario que corresponde a un instante en una zona horaria.
 * Único punto donde una fecha de negocio nace de un instante: lo usan el servicio `Clock`
 * de la API (con `America/Bogota`) y la conversión de las columnas `date` de Prisma (con `UTC`).
 */
export function isoDateFromInstant(instant: Date, timeZone: string): IsoDate {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const find = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return isoDateFromParts(find('year'), find('month'), find('day'));
}

function toUtcMillis(date: IsoDate): number {
  const { year, month, day } = isoDateParts(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMillis(millis: number): IsoDate {
  const date = new Date(millis);
  return isoDateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Suma (o resta, con valores negativos) días de calendario. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMillis(toUtcMillis(date) + days * MS_PER_DAY);
}

/**
 * Suma (o resta) meses. Si el mes de destino no tiene ese día, devuelve su último día:
 * `addMonths('2026-01-31', 1)` es `2026-02-28` (ADR-002).
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = isoDateParts(date);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  return isoDateFromParts(
    targetYear,
    targetMonth,
    Math.min(day, lastDayOfMonth(targetYear, targetMonth)),
  );
}

/** Días completos de `from` a `to`. Negativo si `to` es anterior. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY);
}

/** Orden cronológico: -1 si `a` es anterior, 0 si son el mismo día, 1 si es posterior. */
export function compareIsoDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** ¿`a` es anterior a `b`? */
export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

/** ¿`a` es posterior a `b`? */
export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return a > b;
}

/** ¿`date` está entre `start` y `end`, incluidos ambos extremos? */
export function isWithin(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return date >= start && date <= end;
}

/** La más antigua de las fechas. */
export function minIsoDate(first: IsoDate, ...rest: readonly IsoDate[]): IsoDate {
  return rest.reduce((min, date) => (date < min ? date : min), first);
}

/** La más reciente de las fechas. */
export function maxIsoDate(first: IsoDate, ...rest: readonly IsoDate[]): IsoDate {
  return rest.reduce((max, date) => (date > max ? date : max), first);
}
