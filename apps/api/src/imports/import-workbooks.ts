import {
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  escapeSpreadsheetText,
  isoDateParts,
  type ImportColumnKey,
  type SheetCell,
} from '@hato/shared';
import ExcelJS from 'exceljs';

import type { ErrorRow } from './animal-import.service.js';

/**
 * Libros de Excel de la importación (ANI-09 CA1 y CA5): la plantilla con las listas del
 * catálogo de la finca y el archivo con las filas que tienen errores.
 *
 * Todo texto que viene de la finca o del archivo pasa por `escapeSpreadsheetText`: un nombre de
 * lote como «=HYPERLINK(…)» no se convierte en fórmula al abrir el libro.
 */

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const DATE_COLUMNS = new Set<ImportColumnKey>([
  'birthDate',
  'entryDate',
  'lastCalvingDate',
  'serviceDate',
  'lastWeightDate',
]);
/** Columnas que se guardan como texto, para que Excel no les quite los ceros («087»). */
const TEXT_COLUMNS = new Set<ImportColumnKey>(['code', 'dam', 'sire', 'visualTag', 'din', 'rfid']);
const WIDTHS: Partial<Record<ImportColumnKey, number>> = {
  code: 12,
  name: 16,
  breed: 18,
  birthDate: 14,
  origin: 20,
  dam: 12,
  sire: 22,
  lot: 18,
  rfid: 20,
  din: 18,
  notes: 32,
};
const REQUIRED_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF2CC' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE7EFE4' },
};

/** Letra de la columna número `index` (desde 0). Basta con A–Z: la plantilla tiene 21. */
function letter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Medianoche UTC de la fecha: así Excel muestra el mismo día en cualquier zona. */
function excelDate(date: { date: string }): Date {
  const { year, month, day } = isoDateParts(date.date as never);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Plantilla descargable (CA1): instrucciones, hoja de datos y listas válidas de la finca. */
export async function buildTemplate(catalog: {
  readonly breeds: readonly string[];
  readonly lots: readonly string[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Arreo';

  const instructions = workbook.addWorksheet('Instrucciones');
  instructions.getColumn(1).width = 110;
  const lines = [
    'Plantilla de importación del inventario — Arreo',
    '',
    'Cómo usarla',
    '1. Llena la hoja «Animales», una fila por animal. No cambies los nombres de las columnas.',
    '2. Las columnas con * son obligatorias (encabezado amarillo): Código, Sexo, Raza y Fecha de nacimiento.',
    '3. Fechas en formato dd/mm/aaaa. Pesos en kilogramos, sin letras (452 o 452,5).',
    '4. Sexo, Raza, Procedencia, Lote y las columnas Sí/No tienen listas desplegables (hoja «Listas»).',
    '5. «Código madre» es el código de una hembra de este archivo o que ya esté en el sistema.',
    '6. «Padre» es el código de un macho, o una referencia como «IA pajilla Gyr».',
    '7. «Partos previos» y «Fecha último parto» sirven para saber si es vaca parida u horra; no crean crías.',
    '8. «Preñada = Sí» crea una preñez confirmada; indica la fecha de servicio.',
    '9. «Fecha de ingreso» es para los comprados; si la dejas vacía se toma la de nacimiento y podrás corregirla en la ficha.',
    `10. Hasta ${IMPORT_MAX_ROWS.toLocaleString('es-CO')} filas y 5 MB por archivo. Se aceptan .xlsx y .csv, no archivos con macros.`,
    '11. En el sistema: Importar inventario → Subir archivo → revisar la simulación → Importar.',
  ];
  lines.forEach((text, index) => {
    const cell = instructions.getCell(index + 1, 1);
    cell.value = text;
    if (index === 0 || text === 'Cómo usarla')
      cell.font = { bold: true, size: index === 0 ? 14 : 12 };
  });

  // En este orden: Instrucciones, Animales (la que se abre) y Listas.
  const sheet = workbook.addWorksheet('Animales', { views: [{ state: 'frozen', ySplit: 1 }] });
  const lists = workbook.addWorksheet('Listas');
  const columns: readonly (readonly [string, readonly string[]])[] = [
    ['Sexo', ['Hembra', 'Macho']],
    ['Raza', catalog.breeds],
    ['Procedencia', ['Nacido en la finca', 'Comprado']],
    ['Lote', catalog.lots],
    ['SiNo', ['Sí', 'No']],
  ];
  columns.forEach(([title, values], column) => {
    lists.getCell(1, column + 1).value = title;
    lists.getCell(1, column + 1).font = { bold: true };
    values.forEach((value, row) => {
      lists.getCell(row + 2, column + 1).value = escapeSpreadsheetText(value);
    });
    lists.getColumn(column + 1).width = 24;
  });
  const listRange = (column: number, count: number): string =>
    `Listas!$${letter(column)}$2:$${letter(column)}$${Math.max(2, count + 1)}`;

  workbook.views = [
    { x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' },
  ];
  IMPORT_COLUMNS.forEach((column, index) => {
    const cell = sheet.getCell(1, index + 1);
    cell.value = column.required ? `${column.label}*` : column.label;
    cell.font = { bold: true };
    cell.fill = column.required ? REQUIRED_FILL : HEADER_FILL;
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = WIDTHS[column.key] ?? Math.max(12, column.label.length + 2);
    if (DATE_COLUMNS.has(column.key)) sheetColumn.numFmt = 'dd/mm/yyyy';
    if (TEXT_COLUMNS.has(column.key)) sheetColumn.numFmt = '@';
  });
  const lastRow = IMPORT_MAX_ROWS + 1;
  const validate = (key: ImportColumnKey, formula: string): void => {
    const column = letter(IMPORT_COLUMNS.findIndex((item) => item.key === key));
    // `dataValidations` existe en exceljs 4 aunque sus tipos no lo declaren.
    (
      sheet as unknown as { dataValidations: { add: (range: string, rule: unknown) => void } }
    ).dataValidations.add(`${column}2:${column}${lastRow}`, {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: false,
    });
  };
  validate('sex', listRange(0, 2));
  validate('breed', listRange(1, catalog.breeds.length));
  validate('origin', listRange(2, 2));
  validate('lot', listRange(3, catalog.lots.length));
  validate('birthDateEstimated', listRange(4, 2));
  validate('pregnant', listRange(4, 2));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Filas con error (CA5): las columnas de la plantilla con los valores originales y «Error». */
export async function buildErrorsWorkbook(rows: readonly ErrorRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Arreo';
  const sheet = workbook.addWorksheet('Animales', { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = [
    ...IMPORT_COLUMNS.map((column) => (column.required ? `${column.label}*` : column.label)),
    'Error',
    'Fila original',
  ];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  IMPORT_COLUMNS.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = WIDTHS[column.key] ?? Math.max(12, column.label.length + 2);
    if (DATE_COLUMNS.has(column.key)) sheetColumn.numFmt = 'dd/mm/yyyy';
    if (TEXT_COLUMNS.has(column.key)) sheetColumn.numFmt = '@';
  });
  sheet.getColumn(IMPORT_COLUMNS.length + 1).width = 70;
  sheet.getColumn(IMPORT_COLUMNS.length + 1).alignment = { wrapText: true, vertical: 'top' };

  for (const row of rows) {
    sheet.addRow([
      ...IMPORT_COLUMNS.map((column) => toExcelValue(row.cells[column.key])),
      escapeSpreadsheetText(row.error),
      row.row,
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function toExcelValue(cell: SheetCell | undefined): ExcelJS.CellValue {
  if (cell === undefined || cell === null) return null;
  if (typeof cell === 'object') return excelDate(cell);
  if (typeof cell === 'string') return escapeSpreadsheetText(cell);
  return cell;
}
