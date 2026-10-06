import { Injectable } from '@nestjs/common';
import {
  ALERT_LABEL,
  CATEGORY_LABEL,
  DERIVED_TAG_LABEL,
  ORIGIN_LABEL,
  ROLE,
  SEX_LABEL,
  STATUS_LABEL,
  escapeSpreadsheetText,
  formatAge,
  isoDateParts,
  type AnimalListItem,
  type IsoDate,
  type ListAnimalsQuery,
} from '@hato/shared';
import ExcelJS from 'exceljs';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AnimalListService } from './animal-list.service.js';

/**
 * Exportación del listado a Excel (ANI-06 CA4): exactamente lo que se ve con los filtros de la
 * URL, sin paginar.
 *
 * - Fechas como fechas reales de Excel (medianoche UTC con formato dd/mm/aaaa: el mismo día en
 *   cualquier zona) y números como números.
 * - El valor de compra solo para ADMIN (RN-20): la columna no existe para los demás.
 * - Todo texto que venga de la finca pasa por `escapeSpreadsheetText`: un nombre como
 *   «=HYPERLINK(…)» no se vuelve fórmula al abrir el archivo.
 * - Encabezados en español, fila de encabezado fija, autofiltro y anchos razonables.
 */

type Column = {
  readonly header: string;
  readonly width: number;
  readonly format?: 'date' | 'kg' | 'money' | 'integer';
  readonly value: (animal: AnimalListItem, extra: Extra) => ExcelJS.CellValue;
};

/** Lo que el listado no trae y la exportación sí. */
type Extra = {
  readonly visualTag: string | null;
  readonly din: string | null;
  readonly rfid: string | null;
  readonly damCode: string | null;
  readonly origin: string;
  readonly entryDate: IsoDate;
  readonly exitDate: IsoDate | null;
  readonly purchasePrice: number | null;
};

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const text = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === '' ? null : escapeSpreadsheetText(value);

function excelDate(date: IsoDate | null): Date | null {
  if (date === null) return null;
  const { year, month, day } = isoDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

@Injectable()
export class AnimalExportService {
  constructor(
    private readonly listService: AnimalListService,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Libro con una hoja «Animales»; el nombre del archivo lleva la fecha de hoy. */
  async export(
    scope: FarmScope,
    query: ListAnimalsQuery,
  ): Promise<{ fileName: string; data: Buffer }> {
    const { items } = await this.listService.list(scope, query, { unpaginated: true });
    const extras = await this.extras(scope, items);
    const today = this.clock.today();
    const isAdmin = scope.role === ROLE.ADMIN;

    const columns: Column[] = [
      { header: 'Código', width: 12, value: (animal) => text(animal.code) },
      { header: 'Nombre', width: 18, value: (animal) => text(animal.name) },
      { header: 'Sexo', width: 9, value: (animal) => SEX_LABEL[animal.sex] },
      { header: 'Raza', width: 18, value: (animal) => text(animal.breed.name) },
      {
        header: 'Fecha de nacimiento',
        width: 14,
        format: 'date',
        value: (animal) => excelDate(animal.birthDate),
      },
      {
        header: 'Nacimiento aproximado',
        width: 12,
        value: (animal) => (animal.birthDateEstimated ? 'Sí' : 'No'),
      },
      {
        header: 'Edad',
        width: 12,
        value: (animal) =>
          formatAge({ birthDate: animal.birthDate, today, estimated: animal.birthDateEstimated }),
      },
      { header: 'Edad (meses)', width: 10, format: 'integer', value: (animal) => animal.ageMonths },
      { header: 'Categoría', width: 11, value: (animal) => CATEGORY_LABEL[animal.category] },
      {
        header: 'Etiquetas',
        width: 26,
        value: (animal) =>
          text(
            [
              ...animal.derivedTags.map((tag) => DERIVED_TAG_LABEL[tag]),
              ...animal.manualTags.map((tag) => tag.label),
              ...(animal.forSale ? ['Disponible para venta'] : []),
            ].join(', '),
          ),
      },
      { header: 'Partos', width: 8, format: 'integer', value: (animal) => animal.calvingCount },
      {
        header: 'Parto estimado',
        width: 14,
        format: 'date',
        value: (animal) => excelDate(animal.expectedCalvingDate),
      },
      { header: 'Lote', width: 18, value: (animal) => text(animal.lot?.name) },
      {
        header: 'Último peso (kg)',
        width: 12,
        format: 'kg',
        value: (animal) => animal.lastWeight?.weightKg ?? null,
      },
      {
        header: 'Fecha último peso',
        width: 14,
        format: 'date',
        value: (animal) => excelDate(animal.lastWeight?.weighedOn ?? null),
      },
      {
        header: 'Alertas',
        width: 26,
        value: (animal) => text(animal.alerts.map((alert) => ALERT_LABEL[alert]).join(', ')),
      },
      { header: 'Chapeta', width: 10, value: (_animal, extra) => text(extra.visualTag) },
      { header: 'DIN', width: 18, value: (_animal, extra) => text(extra.din) },
      { header: 'RFID', width: 18, value: (_animal, extra) => text(extra.rfid) },
      { header: 'Madre', width: 10, value: (_animal, extra) => text(extra.damCode) },
      { header: 'Procedencia', width: 16, value: (_animal, extra) => extra.origin },
      {
        header: 'Fecha de ingreso',
        width: 14,
        format: 'date',
        value: (_animal, extra) => excelDate(extra.entryDate),
      },
      { header: 'Estado', width: 10, value: (animal) => STATUS_LABEL[animal.status] },
      {
        header: 'Fecha de salida',
        width: 14,
        format: 'date',
        value: (_animal, extra) => excelDate(extra.exitDate),
      },
      ...(isAdmin
        ? [
            {
              header: 'Valor de compra',
              width: 16,
              format: 'money',
              value: (_animal: AnimalListItem, extra: Extra) => extra.purchasePrice,
            } satisfies Column,
          ]
        : []),
    ];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Arreo';
    const sheet = workbook.addWorksheet('Animales', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));
    sheet.getRow(1).font = { bold: true };
    columns.forEach((column, index) => {
      const numFmt = {
        date: 'dd/mm/yyyy',
        kg: 'General',
        money: '"$"#,##0.00',
        integer: '0',
      }[column.format ?? 'integer'];
      if (column.format !== undefined) sheet.getColumn(index + 1).numFmt = numFmt;
    });
    for (const animal of items) {
      const extra = extras.get(animal.id);
      if (extra === undefined) continue;
      sheet.addRow(columns.map((column) => column.value(animal, extra)));
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };

    return {
      fileName: `animales-${today}.xlsx`,
      data: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  /** Identificadores activos, madre, procedencia, ingreso, salida y (solo ADMIN) compra. */
  private async extras(
    scope: FarmScope,
    items: readonly AnimalListItem[],
  ): Promise<Map<string, Extra>> {
    const ids = items.map((item) => item.id);
    const animals = await this.prisma.animal.findMany({
      where: { farmId: scope.farmId, id: { in: ids } },
      select: {
        id: true,
        origin: true,
        entryDate: true,
        exitDate: true,
        dam: { select: { code: true } },
        identifiers: {
          where: { retiredAt: null, type: { in: ['VISUAL_TAG', 'DIN', 'RFID'] } },
          select: { type: true, value: true },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });
    const prices = new Map<string, number>();
    // RN-20: el valor de compra ni se consulta si quien exporta no es ADMIN.
    if (scope.role === ROLE.ADMIN && ids.length > 0) {
      const allocations = await this.prisma.expenseAllocation.findMany({
        where: {
          farmId: scope.farmId,
          animalId: { in: ids },
          voidedAt: null,
          expense: { type: 'PURCHASE', voidedAt: null },
        },
        select: { animalId: true, amount: true },
        orderBy: { expense: { occurredOn: 'asc' } },
      });
      for (const allocation of allocations) {
        prices.set(allocation.animalId, Number(allocation.amount.toFixed(2)));
      }
    }
    const result = new Map<string, Extra>();
    for (const animal of animals) {
      const first = (type: string): string | null =>
        animal.identifiers.find((identifier) => identifier.type === type)?.value ?? null;
      result.set(animal.id, {
        visualTag: first('VISUAL_TAG'),
        din: first('DIN'),
        rfid: first('RFID'),
        damCode: animal.dam?.code ?? null,
        origin: ORIGIN_LABEL[animal.origin],
        entryDate: fromPrismaDate(animal.entryDate),
        exitDate: animal.exitDate === null ? null : fromPrismaDate(animal.exitDate),
        purchasePrice: prices.get(animal.id) ?? null,
      });
    }
    return result;
  }
}
