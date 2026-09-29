import { Module } from '@nestjs/common';

import { FarmContextService } from '../animals/farm-context.service.js';
import { BirthsReportService } from './births-report.service.js';
import { CalvingsService } from './calvings.service.js';
import { PregnanciesService } from './pregnancies.service.js';
import {
  BirthsReportController,
  CalvingsController,
  PregnanciesController,
} from './reproduction.controller.js';

/** Control reproductivo y nacimientos (M5: REP-01 a REP-05, NAC-01). */
@Module({
  controllers: [PregnanciesController, CalvingsController, BirthsReportController],
  providers: [FarmContextService, PregnanciesService, CalvingsService, BirthsReportService],
})
export class ReproductionModule {}
