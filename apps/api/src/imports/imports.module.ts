import { Module } from '@nestjs/common';

import { FarmContextService } from '../animals/farm-context.service.js';
import { AnimalImportService } from './animal-import.service.js';
import { ImportsController } from './imports.controller.js';

/** Importación del inventario desde Excel o CSV (ANI-09, M4d). */
@Module({
  controllers: [ImportsController],
  providers: [AnimalImportService, FarmContextService],
})
export class ImportsModule {}
