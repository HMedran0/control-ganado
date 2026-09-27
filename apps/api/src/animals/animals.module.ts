import { Module } from '@nestjs/common';

import { AnimalDetailService } from './animal-detail.service.js';
import { AnimalListService } from './animal-list.service.js';
import { AnimalSearchService } from './animal-search.service.js';
import { AnimalsController } from './animals.controller.js';
import { FarmContextService } from './farm-context.service.js';
import { VaccineStatusService } from './vaccine-status.service.js';

/** Animales, clasificación, búsqueda e identificadores (M4a). */
@Module({
  controllers: [AnimalsController],
  providers: [
    FarmContextService,
    VaccineStatusService,
    AnimalListService,
    AnimalSearchService,
    AnimalDetailService,
  ],
})
export class AnimalsModule {}
