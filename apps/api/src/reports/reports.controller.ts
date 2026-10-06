import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  DomainError,
  REPORT,
  exitsReportQuerySchema,
  reportExportFormatSchema,
  vaccinationsReportQuerySchema,
  type CalvingsUpcomingReport,
  type ChartsReport,
  type ExitsReport,
  type ExitsReportQuery,
  type IcaInventoryReport,
  type InventoryReport,
  type ReportName,
  type VaccinationPendingReport,
  type VaccinationsReport,
  type VaccinationsReportQuery,
} from '@hato/shared';
import type { FastifyReply } from 'fastify';

import { XLSX_CONTENT_TYPE } from '../animals/animal-export.service.js';
import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ReportsExportService } from './reports-export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Reportes estándar (RPT-02) y gráficas (RPT-03), M8b. Todos los roles; el precio y el
 * comprador de las salidas, solo el ADMIN (RN-20). El de nacimientos (`GET /reports/births`)
 * sigue en el módulo de reproducción; el económico, en Finanzas.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ReportsExportService,
  ) {}

  @Get(REPORT.INVENTORY)
  inventory(@CurrentScope() scope: FarmScope): Promise<InventoryReport> {
    return this.reports.inventory(scope);
  }

  @Get(REPORT.INVENTORY_ICA)
  icaInventory(@CurrentScope() scope: FarmScope): Promise<IcaInventoryReport> {
    return this.reports.icaInventory(scope);
  }

  @Get(REPORT.VACCINATIONS)
  vaccinations(
    @Query(new ZodValidationPipe(vaccinationsReportQuerySchema)) query: VaccinationsReportQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<VaccinationsReport> {
    return this.reports.vaccinations(scope, query);
  }

  @Get(REPORT.VACCINATION_PENDING)
  vaccinationPending(@CurrentScope() scope: FarmScope): Promise<VaccinationPendingReport> {
    return this.reports.vaccinationPending(scope);
  }

  @Get(REPORT.CALVINGS_UPCOMING)
  calvingsUpcoming(@CurrentScope() scope: FarmScope): Promise<CalvingsUpcomingReport> {
    return this.reports.calvingsUpcoming(scope);
  }

  @Get(REPORT.EXITS)
  exits(
    @Query(new ZodValidationPipe(exitsReportQuerySchema)) query: ExitsReportQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<ExitsReport> {
    return this.reports.exits(scope, query);
  }

  /** Datos de las gráficas de Reportes (RPT-03). */
  @Get('charts')
  charts(@CurrentScope() scope: FarmScope): Promise<ChartsReport> {
    return this.reports.charts(scope);
  }

  /** El reporte en Excel, con los mismos filtros que su JSON (RPT-02 CA1). */
  @Get(':name/export')
  async export(
    @Param('name') name: string,
    @Query() query: Record<string, unknown>,
    @CurrentScope() scope: FarmScope,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { format, ...filters } = query;
    if (!reportExportFormatSchema.safeParse({ format }).success) {
      throw new DomainError('VALIDATION_FAILED', {
        fieldErrors: { format: ['El formato debe ser xlsx.'] },
      });
    }
    const file = await this.exporter.export(scope, name as ReportName, filters);
    reply.header('content-type', XLSX_CONTENT_TYPE);
    reply.header('content-disposition', `attachment; filename="${file.fileName}"`);
    reply.header('cache-control', 'no-store');
    return file.data;
  }
}
