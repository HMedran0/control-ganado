import { Injectable } from '@nestjs/common';
import {
  BIRTH_CONDITION_LABEL,
  CATEGORY_LABEL,
  DomainError,
  EXIT_TYPE_LABEL,
  ICA_AGE_GROUP_LABEL,
  REPORT,
  REPORT_LABEL,
  ROLE,
  SEX_LABEL,
  VACCINE_STATUS_LABEL,
  birthsReportQuerySchema,
  cycleProgressReportQuerySchema,
  exitsReportQuerySchema,
  formatDate,
  vaccinationsReportQuerySchema,
  type IsoDate,
  type ReportName,
} from '@hato/shared';
import type { z } from 'zod';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { BirthsReportService } from '../reproduction/births-report.service.js';
import { VaccinationsService } from '../sanitary/vaccinations.service.js';
import { buildReportWorkbook, type ReportSheet } from './report-workbook.js';
import { ReportsService } from './reports.service.js';

/** Reportes que se descargan por `GET /reports/:name/export` (el económico va por Finanzas). */
export const EXPORTABLE_REPORTS = [
  REPORT.INVENTORY,
  REPORT.INVENTORY_ICA,
  REPORT.CYCLE_PROGRESS,
  REPORT.BIRTHS,
  REPORT.VACCINATIONS,
  REPORT.VACCINATION_PENDING,
  REPORT.CALVINGS_UPCOMING,
  REPORT.EXITS,
] as const;
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

const FILE_BASE: Readonly<Record<ExportableReport, string>> = {
  inventory: 'inventario',
  'inventory-ica': 'grupos-de-edad-ica',
  'cycle-progress': 'avance-del-ciclo',
  births: 'nacimientos',
  vaccinations: 'vacunados',
  'vaccination-pending': 'pendientes-de-vacunacion',
  'calvings-upcoming': 'partos-proximos',
  exits: 'vendidos-y-retirados',
};

const period = (from: IsoDate, to: IsoDate) => `Del ${formatDate(from)} al ${formatDate(to)}.`;
const cutoff = (today: IsoDate) => `Corte: ${formatDate(today)}.`;

/** Valida la consulta de un reporte con su esquema de shared (lo mismo que el JSON). */
function parse<S extends z.ZodType>(schema: S, query: unknown): z.infer<S> {
  const result = schema.safeParse(query);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? 'query');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new DomainError('VALIDATION_FAILED', { fieldErrors });
  }
  return result.data;
}

/**
 * Los reportes estándar en Excel (RPT-02 CA1), con los mismos datos y filtros que su JSON. El
 * precio y el comprador de las salidas solo para el ADMIN (RN-20): la columna no existe para los
 * demás, y el barrido de RN-20 lo vigila.
 */
@Injectable()
export class ReportsExportService {
  constructor(
    private readonly reports: ReportsService,
    private readonly births: BirthsReportService,
    private readonly vaccinations: VaccinationsService,
  ) {}

  async export(
    scope: FarmScope,
    name: ReportName,
    query: Record<string, unknown>,
  ): Promise<{ fileName: string; data: Buffer }> {
    if (!(EXPORTABLE_REPORTS as readonly string[]).includes(name)) {
      throw new DomainError('NOT_FOUND', { detail: 'Ese reporte no existe.' });
    }
    const report = name as ExportableReport;
    const { sheets, suffix } = await this.sheets(scope, report, query);
    return {
      fileName: `${FILE_BASE[report]}-${suffix}.xlsx`,
      data: await buildReportWorkbook(sheets),
    };
  }

  private async sheets(
    scope: FarmScope,
    report: ExportableReport,
    query: Record<string, unknown>,
  ): Promise<{ sheets: ReportSheet[]; suffix: string }> {
    const title = REPORT_LABEL[report].title;
    switch (report) {
      case REPORT.INVENTORY: {
        const data = await this.reports.inventory(scope);
        const bySex = [
          { header: 'Machos', width: 10, kind: 'int' as const },
          { header: 'Hembras', width: 10, kind: 'int' as const },
          { header: 'Total', width: 10, kind: 'int' as const },
        ];
        const context = [cutoff(data.today), `Animales activos: ${data.total}.`];
        return {
          suffix: data.today,
          sheets: [
            {
              name: 'Por categoría',
              title: `${title} por categoría`,
              context,
              columns: [{ header: 'Categoría', width: 18, kind: 'text' }, ...bySex],
              rows: data.byCategory.map((row) => [
                CATEGORY_LABEL[row.category],
                row.males,
                row.females,
                row.total,
              ]),
              totals: [['Total', data.males, data.females, data.total]],
            },
            {
              name: 'Por raza',
              title: `${title} por raza`,
              context,
              columns: [{ header: 'Raza', width: 24, kind: 'text' }, ...bySex],
              rows: data.byBreed.map((row) => [row.name, row.males, row.females, row.total]),
              totals: [['Total', data.males, data.females, data.total]],
            },
            {
              name: 'Por lote',
              title: `${title} por lote`,
              context,
              columns: [{ header: 'Lote', width: 24, kind: 'text' }, ...bySex],
              rows: data.byLot.map((row) => [
                row.name ?? 'Sin lote',
                row.males,
                row.females,
                row.total,
              ]),
              totals: [['Total', data.males, data.females, data.total]],
            },
          ],
        };
      }
      case REPORT.INVENTORY_ICA: {
        const data = await this.reports.icaInventory(scope);
        const place = [data.farm.municipality, data.farm.department].filter(Boolean).join(', ');
        return {
          suffix: data.today,
          sheets: [
            {
              name: 'Grupos de edad ICA',
              title: `Inventario por grupos de edad (formato ICA) — ${data.farm.name}`,
              context: [
                ...(place === '' ? [] : [`Ubicación: ${place}.`]),
                `Código de predio ICA: ${data.farm.icaPremiseCode ?? 'sin registrar'}.`,
                cutoff(data.today),
                'Animales activos por sexo y grupo de edad (08 §2.2). Formato propuesto por Arreo [Validar con el ICA y la finca].',
              ],
              columns: [
                { header: 'Sexo', width: 10, kind: 'text' },
                { header: 'Grupo de edad', width: 20, kind: 'text' },
                { header: 'Animales', width: 10, kind: 'int' },
              ],
              rows: data.groups.map((row) => [
                SEX_LABEL[row.sex],
                ICA_AGE_GROUP_LABEL[row.group],
                row.count,
              ]),
              totals: [
                ['Hembras', 'Total', data.totals.females],
                ['Machos', 'Total', data.totals.males],
                ['Total', '', data.totals.total],
              ],
            },
          ],
        };
      }
      case REPORT.CYCLE_PROGRESS: {
        const { cycleId } = parse(cycleProgressReportQuerySchema, query);
        const data = await this.vaccinations.cycleProgress(scope, cycleId);
        return {
          suffix: data.cycle.name
            .normalize('NFD')
            .replace(/[^A-Za-z0-9]+/g, '-')
            .toLowerCase(),
          sheets: [
            {
              name: 'Avance del ciclo',
              title: `${title}: ${data.cycle.name}`,
              context: [period(data.cycle.startsOn, data.cycle.endsOn)],
              columns: [
                { header: 'Vacuna', width: 24, kind: 'text' },
                { header: 'Debían vacunarse', width: 16, kind: 'int' },
                { header: 'Vacunados', width: 12, kind: 'int' },
                { header: 'Faltan', width: 10, kind: 'int' },
              ],
              rows: data.vaccines.map((row) => [
                row.name,
                row.eligible,
                row.vaccinated,
                row.pending,
              ]),
            },
          ],
        };
      }
      case REPORT.BIRTHS: {
        const data = await this.births.report(scope, parse(birthsReportQuerySchema, query));
        return {
          suffix: `${data.from}-a-${data.to}`,
          sheets: [
            {
              name: 'Nacimientos',
              title,
              context: [
                period(data.from, data.to),
                `Nacidos vivos: ${data.totals.live} (${data.totals.males} machos, ${data.totals.females} hembras). Débiles: ${data.totals.weak}. Muertos al nacer: ${data.totals.stillborn}.`,
              ],
              columns: [
                { header: 'Fecha', width: 12, kind: 'date' },
                { header: 'Cría', width: 12, kind: 'text' },
                { header: 'Sexo', width: 10, kind: 'text' },
                { header: 'Madre', width: 12, kind: 'text' },
                { header: 'Padre', width: 18, kind: 'text' },
                { header: 'Raza', width: 20, kind: 'text' },
                { header: 'Peso al nacer (kg)', width: 16, kind: 'decimal' },
                { header: 'Estado', width: 10, kind: 'text' },
              ],
              rows: data.items.map((row) => [
                row.birthDate,
                row.calf.code,
                SEX_LABEL[row.calf.sex],
                row.dam?.code ?? null,
                row.sire?.code ?? row.sireExternalRef,
                row.breed,
                row.birthWeightKg,
                row.birthCondition === null ? null : BIRTH_CONDITION_LABEL[row.birthCondition],
              ]),
            },
            {
              name: 'Muertos al nacer',
              title: 'Partos con crías muertas al nacer',
              context: [period(data.from, data.to)],
              columns: [
                { header: 'Fecha', width: 12, kind: 'date' },
                { header: 'Madre', width: 12, kind: 'text' },
                { header: 'Crías muertas', width: 14, kind: 'int' },
              ],
              rows: data.stillbirths.map((row) => [row.date, row.dam.code, row.count]),
            },
          ],
        };
      }
      case REPORT.VACCINATIONS: {
        const data = await this.reports.vaccinations(
          scope,
          parse(vaccinationsReportQuerySchema, query),
        );
        return {
          suffix: `${data.from}-a-${data.to}`,
          sheets: [
            {
              name: 'Por vacuna',
              title: `${title} por vacuna`,
              context: [period(data.from, data.to)],
              columns: [
                { header: 'Vacuna', width: 24, kind: 'text' },
                { header: 'Aplicaciones', width: 14, kind: 'int' },
              ],
              rows: data.byVaccine.map((row) => [row.name, row.count]),
              totals: [['Total', data.items.length]],
            },
            {
              name: 'Vacunados',
              title,
              context: [period(data.from, data.to)],
              columns: [
                { header: 'Fecha', width: 12, kind: 'date' },
                { header: 'Animal', width: 12, kind: 'text' },
                { header: 'Vacuna', width: 24, kind: 'text' },
                { header: 'Dosis', width: 12, kind: 'text' },
                { header: 'Ciclo', width: 22, kind: 'text' },
                { header: 'RUV', width: 14, kind: 'text' },
                { header: 'Responsable', width: 20, kind: 'text' },
              ],
              rows: data.items.map((row) => [
                row.appliedOn,
                row.animal.code,
                row.vaccine.name,
                row.dose,
                row.cycle,
                row.ruvNumber,
                row.responsible,
              ]),
            },
          ],
        };
      }
      case REPORT.VACCINATION_PENDING: {
        const data = await this.reports.vaccinationPending(scope);
        return {
          suffix: data.today,
          sheets: [
            {
              name: 'Pendientes',
              title,
              context: [
                cutoff(data.today),
                `Animales con alguna vacuna por aplicar: ${data.animals}.`,
              ],
              columns: [
                { header: 'Animal', width: 12, kind: 'text' },
                { header: 'Categoría', width: 14, kind: 'text' },
                { header: 'Lote', width: 18, kind: 'text' },
                { header: 'Vacuna', width: 24, kind: 'text' },
                { header: 'Estado', width: 12, kind: 'text' },
                { header: 'Fecha', width: 12, kind: 'date' },
              ],
              rows: data.items.map((row) => [
                row.animal.code,
                CATEGORY_LABEL[row.category],
                row.lot,
                row.vaccine.name,
                VACCINE_STATUS_LABEL[row.status],
                row.dueOn,
              ]),
            },
          ],
        };
      }
      case REPORT.CALVINGS_UPCOMING: {
        const data = await this.reports.calvingsUpcoming(scope);
        return {
          suffix: data.today,
          sheets: [
            {
              name: 'Partos próximos',
              title,
              context: [
                cutoff(data.today),
                `Preñadas que paren en los próximos ${data.windowDays} días o ya debían parir.`,
              ],
              columns: [
                { header: 'Hembra', width: 12, kind: 'text' },
                { header: 'Lote', width: 18, kind: 'text' },
                { header: 'Servicio', width: 12, kind: 'date' },
                { header: 'Padre', width: 18, kind: 'text' },
                { header: 'Parto estimado', width: 15, kind: 'date' },
                { header: 'Días', width: 8, kind: 'int' },
              ],
              rows: data.items.map((row) => [
                row.dam.code,
                row.lot,
                row.serviceDate,
                row.sire,
                row.expectedCalvingDate,
                row.daysToCalving,
              ]),
            },
          ],
        };
      }
      case REPORT.EXITS: {
        const data = await this.reports.exits(scope, parse(exitsReportQuerySchema, query));
        const admin = scope.role === ROLE.ADMIN;
        return {
          suffix: `${data.from}-a-${data.to}`,
          sheets: [
            {
              name: 'Salidas',
              title,
              context: [
                period(data.from, data.to),
                data.byType
                  .map((row) => `${EXIT_TYPE_LABEL[row.type]}: ${row.count}`)
                  .join(' · ') || 'Sin salidas en el período.',
              ],
              columns: [
                { header: 'Fecha', width: 12, kind: 'date' },
                { header: 'Animal', width: 12, kind: 'text' },
                { header: 'Sexo', width: 10, kind: 'text' },
                { header: 'Salida', width: 22, kind: 'text' },
                { header: 'Motivo', width: 28, kind: 'text' },
                ...(admin
                  ? [
                      { header: 'Precio de venta', width: 16, kind: 'money' as const },
                      { header: 'Comprador', width: 22, kind: 'text' as const },
                    ]
                  : []),
              ],
              rows: data.items.map((row) => [
                row.exitDate,
                row.animal.code,
                SEX_LABEL[row.animal.sex],
                EXIT_TYPE_LABEL[row.exitType],
                row.reason,
                ...(admin ? [row.salePrice ?? null, row.buyer ?? null] : []),
              ]),
            },
          ],
        };
      }
    }
  }
}
