import { Module } from '@nestjs/common';

import { AnimalDetailService } from '../animals/animal-detail.service.js';
import { FarmContextService } from '../animals/farm-context.service.js';
import { VaccineStatusService } from '../animals/vaccine-status.service.js';
import { ScaleProfilesService } from './scale-profiles.service.js';
import { WeightImportService } from './weight-import.service.js';
import {
  AnimalWeightsController,
  ScaleProfilesController,
  WeightsController,
} from './weights.controller.js';
import { WeightsService } from './weights.service.js';

/** Pesos y báscula (M6: PES-01, PES-02, PES-04, PES-05). */
@Module({
  controllers: [WeightsController, AnimalWeightsController, ScaleProfilesController],
  providers: [
    FarmContextService,
    VaccineStatusService,
    AnimalDetailService,
    WeightsService,
    ScaleProfilesService,
    WeightImportService,
  ],
})
export class WeightsModule {}
