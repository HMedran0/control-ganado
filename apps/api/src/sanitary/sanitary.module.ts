import { Module } from '@nestjs/common';

import { AnimalListService } from '../animals/animal-list.service.js';
import { FarmContextService } from '../animals/farm-context.service.js';
import { VaccineStatusService } from '../animals/vaccine-status.service.js';
import {
  CycleProgressController,
  TreatmentsController,
  VaccinationsController,
} from './sanitary.controller.js';
import { TreatmentsService } from './treatments.service.js';
import { VaccinationsService } from './vaccinations.service.js';

/** Sanidad (M6: SAN-02 a SAN-06): vacunaciones, vacunación por lote, ciclos y tratamientos. */
@Module({
  controllers: [VaccinationsController, CycleProgressController, TreatmentsController],
  providers: [
    FarmContextService,
    VaccineStatusService,
    AnimalListService,
    VaccinationsService,
    TreatmentsService,
  ],
})
export class SanitaryModule {}
