import { Injectable } from '@nestjs/common';
import {
  CATEGORY_LABEL,
  EXPENSE_TYPE_LABEL,
  escapeSpreadsheetText,
  isoDateParts,
  type FinanceSummaryQuery,
  type IsoDate,
  type MoneyString,
} from '@hato/shared';
import ExcelJS from 'exceljs';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { FinanceReportsService } from './finance-reports.service.js';

/**
 * Reporte económico en Excel (ECO-06), solo ADMIN (RN-20). Las mismas cifras de
 * `GET /finance/summary`, una hoja por bloque, con las reglas de la exportación de M4d: fechas como
 * fechas de Excel, montos como números, encabezados en español con la fila fija, y todo texto que
 * venga de la finca (descripciones, compradores, nombres) escapado con `escapeSpreadsheetText`
 * para que no se ejecute como fórmula.
 */
@Injectable()
export class FinanceExportService {
  constructor(private readonly reports: FinanceReportsService) {}

  async export(
    scope: FarmScope,
    query: FinanceSummaryQuery,
  ): Promise<{ fileName: string; data: Buffer }> {
    const summary = await this.reports.summary(scope, query);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arreo';

    const overview = sheet(workbook, 'Resumen', [
      { header: 'Concepto', width: 38 },
      { header: 'Valor', width: 18, numFmt: MONEY },
    ]);
    overview.addRows([
      ['Desde', excelDate(summary.from)],
      ['Hasta', excelDate(summary.to)],
      ['Gastos del período', money(summary.expenses.total)],
      ['  Cargados a animales', money(summary.expenses.allocated)],
      ['  Gastos generales de la finca', money(summary.expenses.general)],
      ['Ventas del período', money(summary.sales.total)],
      ['Animales vendidos', summary.sales.count],
      ['Inversión de los vendidos', money(summary.sales.investment)],
      ['Resultado de los vendidos', money(summary.sales.result)],
      ['Animales activos', summary.herd.animals],
      ['Inversión acumulada del hato activo', money(summary.herd.investment)],
    ]);
    for (const row of [2, 3]) overview.getCell(row, 2).numFmt = DATE;
    for (const row of [8, 11]) overview.getCell(row, 2).numFmt = '0';

    const byCategory = sheet(workbook, 'Inversión por categoría', [
      { header: 'Categoría', width: 16 },
      { header: 'Animales', width: 10, numFmt: '0' },
      { header: 'Inversión', width: 18, numFmt: MONEY },
    ]);
    for (const row of summary.herd.byCategory) {
      byCategory.addRow([CATEGORY_LABEL[row.category], row.animals, money(row.investment)]);
    }

    const byType = sheet(workbook, 'Gastos por tipo', [
      { header: 'Tipo de gasto', width: 18 },
      { header: 'Monto', width: 18, numFmt: MONEY },
    ]);
    for (const row of summary.expenses.byType) {
      byType.addRow([EXPENSE_TYPE_LABEL[row.type], money(row.amount)]);
    }

    const byMonth = sheet(workbook, 'Gastos por mes', [
      { header: 'Mes', width: 12, numFmt: 'mm/yyyy' },
      { header: 'Monto', width: 18, numFmt: MONEY },
    ]);
    for (const row of summary.expenses.byMonth) {
      byMonth.addRow([excelDate(`${row.month}-01` as IsoDate), money(row.amount)]);
    }

    const sales = sheet(workbook, 'Ventas', [
      { header: 'Fecha', width: 12, numFmt: DATE },
      { header: 'Código', width: 12 },
      { header: 'Nombre', width: 18 },
      { header: 'Comprador', width: 24 },
      { header: 'Precio de venta', width: 18, numFmt: MONEY },
      { header: 'Inversión', width: 18, numFmt: MONEY },
      { header: 'Resultado', width: 18, numFmt: MONEY },
    ]);
    for (const item of summary.sales.items) {
      sales.addRow([
        excelDate(item.date),
        text(item.animal.code),
        text(item.animal.name),
        text(item.buyer),
        money(item.amount),
        money(item.investment),
        money(item.result),
      ]);
    }

    return {
      fileName: `reporte-economico-${summary.from}-a-${summary.to}.xlsx`,
      data: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
}

/** Formato de los montos: pesos sin decimales a la vista, el valor conserva los centavos. */
const MONEY = '"$"#,##0';
const DATE = 'dd/mm/yyyy';

type ColumnSpec = { readonly header: string; readonly width: number; readonly numFmt?: string };

/** Hoja con encabezados en negrita, fila fija y autofiltro. */
function sheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly ColumnSpec[],
): ExcelJS.Worksheet {
  const result = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  result.columns = columns.map((column) => ({ header: column.header, width: column.width }));
  result.getRow(1).font = { bold: true };
  columns.forEach((column, index) => {
    if (column.numFmt !== undefined) result.getColumn(index + 1).numFmt = column.numFmt;
  });
  result.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return result;
}

/** Monto como número de Excel. Solo para mostrar: los cálculos ya se hicieron en centavos. */
function money(value: MoneyString): number {
  return Number(value);
}

function text(value: string | null): string | null {
  return value === null || value === '' ? null : escapeSpreadsheetText(value);
}

function excelDate(date: IsoDate): Date {
  const { year, month, day } = isoDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}
