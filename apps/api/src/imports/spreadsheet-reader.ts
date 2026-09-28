import {
  DomainError,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  isoDateFromParts,
  type SheetCell,
} from '@hato/shared';
import ExcelJS from 'exceljs';

import { sanitizeForExcelJs } from './xlsx-sanitize.js';

import {
  buildStoredZip,
  looksLikeZip,
  readZipEntries,
  XLSX_ZIP_LIMITS,
  ZipRejected,
} from './zip-guard.js';

/**
 * Lee el archivo que sube la persona (ANI-09) sin confiar en él (ADR-011):
 *
 * - solo `.xlsx` y `.csv`, con un máximo de 5 MB; `.xlsm` (con macros) se rechaza por extensión,
 *   por tipo y por contenido;
 * - el tipo se comprueba por el **contenido**, no por el nombre: un `.xlsx` tiene que ser un ZIP
 *   con el tipo de contenido de una hoja sin macros, y un `.csv` tiene que ser texto;
 * - el `.xlsx` pasa primero por `zip-guard` (bomba ZIP, nombres que salen de la carpeta) y
 *   `exceljs` abre la copia sin comprimir que ese módulo arma;
 * - de las fórmulas se toma el **valor guardado** y nunca se evalúan: `exceljs` no calcula, y una
 *   fórmula sin valor guardado es un error de la fila;
 * - el CSV se decodifica como UTF-8 y, si no lo es, como Windows-1252 (lo que guarda Excel en
 *   Windows), con separador `;`, `,` o tabulador según la fila de encabezados.
 */

/** Archivo tal como llega del formulario. */
export type UploadedFile = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Buffer;
};

/** Problema de una celda que se detecta al leerla (fórmula sin valor, error de Excel). */
export type CellIssue = {
  readonly row: number;
  readonly columnIndex: number;
  readonly message: string;
};

/** Hoja leída: encabezados, filas de datos con su número y problemas de lectura. */
export type SheetContent = {
  readonly kind: 'xlsx' | 'csv';
  readonly header: readonly SheetCell[];
  readonly rows: readonly { readonly row: number; readonly cells: readonly SheetCell[] }[];
  readonly cellIssues: readonly CellIssue[];
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Tipos con los que los navegadores mandan un .xlsx o un .csv (Windows usa el de Excel para CSV). */
const XLSX_MIMES = new Set([XLSX_MIME, 'application/octet-stream', '']);
const CSV_MIMES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'text/comma-separated-values',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '',
]);
/** Firmas de archivos binarios que nunca son un CSV. */
const BINARY_SIGNATURES = [
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), // Office antiguo (.xls, .doc)
  Buffer.from('%PDF'),
  Buffer.from('MZ'),
  Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG
  Buffer.from([0xff, 0xd8, 0xff]), // JPEG
];

function invalid(detail: string): DomainError {
  return new DomainError('IMPORT_FILE_INVALID', { detail });
}

const MACROS =
  'El archivo tiene macros (.xlsm) y no se acepta. Guárdalo como «Libro de Excel (.xlsx)» y vuelve a subirlo.';

/**
 * Lee la hoja de datos del archivo.
 *
 * @throws {DomainError} `IMPORT_FILE_TOO_LARGE`, `IMPORT_FILE_INVALID` o `IMPORT_TOO_MANY_ROWS`.
 */
export async function readSpreadsheet(file: UploadedFile): Promise<SheetContent> {
  if (file.data.length > IMPORT_MAX_BYTES) throw new DomainError('IMPORT_FILE_TOO_LARGE');
  if (file.data.length === 0) throw invalid('El archivo está vacío.');

  const extension = /\.([^.]+)$/.exec(file.fileName.toLowerCase())?.[1] ?? '';
  const mime = file.mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (extension === 'xlsm' || mime.includes('macroenabled')) throw invalid(MACROS);

  if (extension === 'xlsx') {
    if (!XLSX_MIMES.has(mime)) throw invalid('El archivo no es un libro de Excel (.xlsx).');
    if (!looksLikeZip(file.data)) throw invalid('El archivo dice ser .xlsx pero no lo es.');
    return limitRows(await readXlsx(file.data));
  }
  if (extension === 'csv') {
    if (!CSV_MIMES.has(mime)) throw invalid('El archivo no es un CSV.');
    if (
      looksLikeZip(file.data) ||
      BINARY_SIGNATURES.some((signature) => startsWith(file.data, signature))
    ) {
      throw invalid('El archivo dice ser .csv pero no es texto.');
    }
    return limitRows(readCsv(file.data));
  }
  throw invalid('Sube un archivo .xlsx o .csv.');
}

function startsWith(data: Buffer, prefix: Buffer): boolean {
  return data.length >= prefix.length && data.subarray(0, prefix.length).equals(prefix);
}

function limitRows(content: SheetContent): SheetContent {
  if (content.rows.length > IMPORT_MAX_ROWS) throw new DomainError('IMPORT_TOO_MANY_ROWS');
  return content;
}

// ---------------------------------------------------------------------------------------------
// .xlsx
// ---------------------------------------------------------------------------------------------

async function readXlsx(data: Buffer): Promise<SheetContent> {
  let entries;
  try {
    entries = readZipEntries(data, XLSX_ZIP_LIMITS);
  } catch (error) {
    if (error instanceof ZipRejected) {
      throw invalid(
        'No pudimos abrir el archivo de forma segura. Ábrelo en Excel, guárdalo como .xlsx y vuelve a subirlo.',
      );
    }
    throw error;
  }
  const names = new Set(entries.map((entry) => entry.name));
  const contentTypes =
    entries.find((entry) => entry.name === '[Content_Types].xml')?.data.toString('utf8') ?? '';
  if (
    [...names].some((name) => name.toLowerCase().endsWith('vbaproject.bin')) ||
    /macroEnabled/i.test(contentTypes)
  ) {
    throw invalid(MACROS);
  }
  if (!contentTypes.includes('spreadsheetml.sheet.main+xml') || !names.has('xl/workbook.xml')) {
    throw invalid('El archivo no es un libro de Excel (.xlsx).');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // Solo lo que ya se midió, sin compresión: exceljs no tiene nada que inflar.
    await workbook.xlsx.load(buildStoredZip(sanitizeForExcelJs(entries)) as unknown as ArrayBuffer);
  } catch {
    throw invalid(
      'No pudimos leer el libro de Excel. Ábrelo en Excel, guárdalo y vuelve a subirlo.',
    );
  }

  const sheet =
    workbook.worksheets.find((candidate) => candidate.name.trim().toLowerCase() === 'animales') ??
    workbook.worksheets.find((candidate) => candidate.state === 'visible') ??
    workbook.worksheets[0];
  if (sheet === undefined) throw invalid('El libro no tiene hojas.');

  const header: SheetCell[] = [];
  const rows: { row: number; cells: SheetCell[] }[] = [];
  const cellIssues: CellIssue[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: SheetCell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const read = toSheetCell(cell.value);
      cells[columnNumber - 1] = read.cell;
      if (read.issue !== null)
        cellIssues.push({ row: rowNumber, columnIndex: columnNumber - 1, message: read.issue });
    });
    if (rowNumber === 1) header.push(...cells);
    else if (cells.some((cell) => cell !== null && cell !== undefined && cell !== '')) {
      rows.push({ row: rowNumber, cells: Array.from(cells, (cell) => cell ?? null) });
    }
  });
  return { kind: 'xlsx', header: Array.from(header, (cell) => cell ?? null), rows, cellIssues };
}

/** Valor de una celda de exceljs → `SheetCell`, o el problema que tiene. */
export function toSheetCell(value: ExcelJS.CellValue): { cell: SheetCell; issue: string | null } {
  if (value === null || value === undefined) return { cell: null, issue: null };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { cell: value, issue: null };
  }
  if (value instanceof Date) {
    // exceljs convierte la fecha serial a medianoche UTC: sus partes UTC son el día de la hoja.
    if (Number.isNaN(value.getTime()))
      return { cell: null, issue: 'La fecha de la celda no es válida.' };
    return {
      cell: {
        date: isoDateFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()),
      },
      issue: null,
    };
  }
  if ('error' in value) {
    return { cell: null, issue: `La celda tiene un error de Excel (${String(value.error)}).` };
  }
  if ('formula' in value || 'sharedFormula' in value) {
    // Nunca se evalúa: se usa lo que Excel guardó la última vez que calculó.
    const result = (value as { result?: ExcelJS.CellValue }).result;
    if (result === undefined || result === null) {
      return {
        cell: null,
        issue:
          'La celda tiene una fórmula sin valor guardado. Ábrela en Excel, guárdala y vuelve a subirla.',
      };
    }
    return toSheetCell(result);
  }
  if ('richText' in value)
    return { cell: value.richText.map((part) => part.text).join(''), issue: null };
  if ('text' in value && typeof value.text === 'string') return { cell: value.text, issue: null };
  return { cell: null, issue: 'No pudimos leer el contenido de la celda.' };
}

// ---------------------------------------------------------------------------------------------
// .csv
// ---------------------------------------------------------------------------------------------

/** Texto del CSV: UTF-8 (con o sin BOM) o, si no lo es, Windows-1252. */
export function decodeCsv(data: Buffer): string {
  if (data.includes(0)) throw invalid('El archivo dice ser .csv pero no es texto.');
  const body = startsWith(data, Buffer.from([0xef, 0xbb, 0xbf])) ? data.subarray(3) : data;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}

/** Separador de la fila de encabezados: el que más aparece fuera de comillas. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of [';', ',', '\t']) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Filas del CSV (RFC 4180: comillas dobles, `""` dentro de comillas y saltos de línea citados). */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(data: Buffer): SheetContent {
  const lines = parseCsv(decodeCsv(data));
  const toCells = (line: readonly string[]): SheetCell[] =>
    line.map((value) => (value.trim() === '' ? null : value));
  const [first = [], ...rest] = lines;
  const rows = rest
    .map((line, index) => ({ row: index + 2, cells: toCells(line) }))
    .filter((line) => line.cells.some((cell) => cell !== null));
  return { kind: 'csv', header: toCells(first), rows, cellIssues: [] };
}
