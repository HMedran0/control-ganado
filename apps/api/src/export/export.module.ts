import { Module } from '@nestjs/common';

import { ExportController } from './export.controller.js';
import { FullExportService } from './full-export.service.js';

/** Exportación completa de la finca (BAK-02, M8b). */
@Module({
  controllers: [ExportController],
  providers: [FullExportService],
})
export class ExportModule {}
