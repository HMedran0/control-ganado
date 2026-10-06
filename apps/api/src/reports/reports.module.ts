import { Module } from '@nestjs/common';

import { FarmContextService } from '../animals/farm-context.service.js';
import { ReproductionModule } from '../reproduction/reproduction.module.js';
import { SanitaryModule } from '../sanitary/sanitary.module.js';
import { ReportsExportService } from './reports-export.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reportes estándar en pantalla y en Excel (RPT-02) y gráficas (RPT-03), M8b. */
@Module({
  imports: [ReproductionModule, SanitaryModule],
  controllers: [ReportsController],
  providers: [FarmContextService, ReportsService, ReportsExportService],
})
export class ReportsModule {}
