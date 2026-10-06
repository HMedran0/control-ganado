import { Module } from '@nestjs/common';

import { FarmContextService } from '../animals/farm-context.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/** Tablero de Inicio por sistema productivo (RPT-01, CFG-03, PES-05, PES-06; M8a). */
@Module({
  controllers: [DashboardController],
  providers: [FarmContextService, DashboardService],
})
export class DashboardModule {}
