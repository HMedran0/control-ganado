import { escapeSpreadsheetText, isoDateParts, type IsoDate } from '@hato/shared';
import ExcelJS from 'exceljs';

/**
 * Libro de Excel de un reporte (RPT-02 CA1): una o varias hojas, cada una con un título, unas
 * líneas de contexto (finca, período, fecha de corte) y una tabla con encabezado fijo y
 * autofiltro. Fechas como fechas reales, números como números y todo texto protegido contra
 * fórmulas (M4d). Los reportes son pequeños (como mucho miles de filas): se arman en memoria.
 */

export type CellKind = 'text' | 'date' | 'int' | 'decimal' | 'money';

export type ReportColumn = {
  readonly header: string;
  readonly width: number;
  readonly kind: CellKind;
};

export type ReportSheet = {
  /** Nombre de la pestaña: hasta 31 caracteres. */
  readonly name: string;
  readonly title: string;
  readonly context: readonly string[];
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly (readonly unknown[])[];
  /** Filas de totales al final, en negrita. */
  readonly totals?: readonly (readonly unknown[])[];
};

const NUM_FMT: Partial<Record<CellKind, string>> = {
  date: 'dd/mm/yyyy',
  int: '0',
  decimal: '0.00',
  money: '"$"#,##0',
};

/** Fecha de negocio como fecha real de Excel (medianoche UTC: el mismo día en cualquier zona). */
export function excelDate(date: IsoDate): Date {
  const { year, month, day } = isoDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function cell(kind: CellKind, value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined || value === '') return null;
  switch (kind) {
    case 'text':
      return escapeSpreadsheetText(typeof value === 'string' ? value : JSON.stringify(value));
    case 'date':
      return excelDate(value as IsoDate);
    case 'int':
    case 'decimal':
    case 'money':
      return typeof value === 'number' ? value : Number(value);
  }
}

export async function buildReportWorkbook(sheets: readonly ReportSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Arreo';
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name.slice(0, 31));
    sheet.columns = spec.columns.map((column) => ({
      width: column.width,
      ...(NUM_FMT[column.kind] === undefined ? {} : { style: { numFmt: NUM_FMT[column.kind] } }),
    }));
    const title = sheet.addRow([escapeSpreadsheetText(spec.title)]);
    title.font = { bold: true, size: 14 };
    for (const line of spec.context) sheet.addRow([escapeSpreadsheetText(line)]);
    sheet.addRow([]);
    const header = sheet.addRow(spec.columns.map((column) => column.header));
    header.font = { bold: true };
    const headerRow = header.number;
    for (const values of spec.rows) {
      sheet.addRow(spec.columns.map((column, index) => cell(column.kind, values[index])));
    }
    for (const values of spec.totals ?? []) {
      const row = sheet.addRow(
        spec.columns.map((column, index) => cell(column.kind, values[index])),
      );
      row.font = { bold: true };
    }
    sheet.views = [{ state: 'frozen', ySplit: headerRow }];
    if (spec.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow + spec.rows.length, column: spec.columns.length },
      };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
