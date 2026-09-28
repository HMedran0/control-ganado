/**
 * Lectura de valores escritos en español de Colombia, tal como llegan de una hoja de cálculo o
 * de un CSV (ANI-09; también la importación de la báscula, PES-04).
 *
 * Una celda llega ya reducida a `SheetCell` por quien lee el archivo: texto, número, sí/no, una
 * fecha de Excel (ya convertida a `IsoDate`, sin `Date`: ADR-002) o vacía. Las funciones no
 * lanzan: devuelven el valor o un mensaje en español para mostrar junto a la fila.
 */

import { addDays, isoDateFromParts, isIsoDate, toIsoDate, type IsoDate } from '../date.js';
import { formatDate } from './date.js';

/** Celda de una hoja ya leída. */
export type SheetCell = string | number | boolean | { readonly date: IsoDate } | null;

/** Resultado de leer una celda. */
export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = <T>(message: string): ParseResult<T> => ({ ok: false, message });

function isDateCell(cell: SheetCell): cell is { readonly date: IsoDate } {
  return typeof cell === 'object' && cell !== null;
}

/** ¿La celda está vacía (o solo tiene espacios)? */
export function isEmptyCell(cell: SheetCell | undefined): boolean {
  return cell === undefined || cell === null || (typeof cell === 'string' && cell.trim() === '');
}

/**
 * Texto de la celda, sin espacios sobrantes. Un número entero sale sin decimales ni notación
 * científica (un RFID guardado como número, 170000123456789, sale igual); una fecha, dd/mm/aaaa.
 */
export function cellText(cell: SheetCell | undefined): string {
  if (cell === undefined || cell === null) return '';
  if (typeof cell === 'string') return cell.trim().replace(/\s+/g, ' ');
  if (typeof cell === 'boolean') return cell ? 'Sí' : 'No';
  if (typeof cell === 'number') {
    return Number.isInteger(cell)
      ? cell.toLocaleString('en-US', { useGrouping: false })
      : String(cell);
  }
  return formatDate(cell.date);
}

/** Primer día de las fechas seriales de Excel (sistema 1900, con su 29/02/1900 inexistente). */
const EXCEL_EPOCH = toIsoDate('1899-12-30');
/** 31/12/9999, la última fecha que Excel representa. */
const EXCEL_MAX_SERIAL = 2_958_465;

/**
 * Fecha serial de Excel → `IsoDate`. Excel cuenta desde el 1/1/1900 e incluye un 29/02/1900 que
 * no existió; desde el 1/3/1900 (serial 61) basta con sumar días al 30/12/1899. Las fracciones
 * (la hora) se descartan.
 *
 * @returns `null` si el número no es una fecha que tenga sentido.
 */
export function excelSerialToIsoDate(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > EXCEL_MAX_SERIAL) return null;
  return addDays(EXCEL_EPOCH, Math.floor(serial));
}

const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Fecha en formato es-CO: una fecha de Excel, `dd/mm/aaaa` (también con `-` o `.`, y día o mes
 * de una cifra) o `aaaa-mm-dd`. El año va completo: «01/02/26» es ambiguo y se rechaza.
 */
export function parseEsCoDate(cell: SheetCell | undefined): ParseResult<IsoDate> {
  if (isEmptyCell(cell)) return fail('Escribe la fecha (dd/mm/aaaa).');
  if (isDateCell(cell!)) return ok(cell.date);
  if (typeof cell === 'number') {
    const date = excelSerialToIsoDate(cell);
    return date === null ? fail(`«${cellText(cell)}» no es una fecha válida.`) : ok(date);
  }
  const text = cellText(cell);
  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst !== null) {
    const [, day, month, year] = dayFirst;
    return partsToDate(Number(year), Number(month), Number(day), text);
  }
  const iso = ISO.exec(text);
  if (iso !== null && isIsoDate(text)) return ok(text);
  return fail(
    `«${text}» no es una fecha válida. Usa el formato dd/mm/aaaa, por ejemplo 15/03/2024.`,
  );
}

function partsToDate(year: number, month: number, day: number, text: string): ParseResult<IsoDate> {
  try {
    return ok(isoDateFromParts(year, month, day));
  } catch {
    return fail(`«${text}» no es una fecha que exista.`);
  }
}

const COMMA_DECIMAL = /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/;
const DOT_THOUSANDS = /^-?\d{1,3}(\.\d{3})+$/;
const DOT_DECIMAL = /^-?\d+\.\d+$/;
const PLAIN = /^-?\d+$/;

/**
 * Número decimal en formato es-CO: coma decimal y punto de miles («1.234,5», «452,5», «452»).
 * También se acepta el punto decimal («452.5») cuando no puede ser un separador de miles: un
 * punto seguido de exactamente tres cifras («1.234») se lee como miles, como en Colombia.
 * No se aceptan letras ni unidades («452 kg»).
 */
export function parseEsCoDecimal(cell: SheetCell | undefined): ParseResult<number> {
  if (isEmptyCell(cell)) return fail('Escribe el número.');
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? ok(cell) : fail('El número no es válido.');
  }
  const text = cellText(cell).replace(/\s/g, '');
  let normalized: string | null = null;
  if (PLAIN.test(text)) normalized = text;
  else if (text.includes(',') && COMMA_DECIMAL.test(text)) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (DOT_THOUSANDS.test(text)) normalized = text.replace(/\./g, '');
  else if (DOT_DECIMAL.test(text)) normalized = text;

  if (normalized === null) {
    return fail(
      `«${cellText(cell)}» no es un número. Escribe solo el número, sin letras ni unidades.`,
    );
  }
  return ok(Number(normalized));
}

/** Entero no negativo («4», 4 o «4,0»). */
export function parseNonNegativeInteger(cell: SheetCell | undefined): ParseResult<number> {
  const parsed = parseEsCoDecimal(cell);
  if (!parsed.ok) return parsed;
  if (!Number.isInteger(parsed.value) || parsed.value < 0) {
    return fail(`«${cellText(cell)}» debe ser un número entero, sin decimales.`);
  }
  return parsed;
}

const YES = new Set(['si', 'sí', 's', 'x', 'verdadero', 'true', '1']);
const NO = new Set(['no', 'n', 'falso', 'false', '0']);

/** Sí o No. Vacía cuenta como No. */
export function parseYesNo(cell: SheetCell | undefined): ParseResult<boolean> {
  if (isEmptyCell(cell)) return ok(false);
  if (typeof cell === 'boolean') return ok(cell);
  const text = cellText(cell).toLocaleLowerCase('es-CO');
  if (YES.has(text)) return ok(true);
  if (NO.has(text)) return ok(false);
  return fail(`«${cellText(cell)}» no es Sí ni No.`);
}
