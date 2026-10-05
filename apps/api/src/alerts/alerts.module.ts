import { Module } from '@nestjs/common';

import { AnimalListService } from '../animals/animal-list.service.js';
import { FarmContextService } from '../animals/farm-context.service.js';
import { VaccineStatusService } from '../animals/vaccine-status.service.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

/** Página de Alertas (M6): reproducción, vacunas, retiros y pesos. */
@Module({
  controllers: [AlertsController],
  providers: [FarmContextService, VaccineStatusService, AnimalListService, AlertsService],
})
export class AlertsModule {}
