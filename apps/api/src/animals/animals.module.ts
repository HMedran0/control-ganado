import { Module } from '@nestjs/common';

import { AnimalDetailService } from './animal-detail.service.js';
import { AnimalLifecycleService } from './animal-lifecycle.service.js';
import { AnimalListService } from './animal-list.service.js';
import { AnimalSearchService } from './animal-search.service.js';
import { AnimalsController, IdentifiersController } from './animals.controller.js';
import { AnimalsService } from './animals.service.js';
import { FarmContextService } from './farm-context.service.js';
import { IdentifiersService } from './identifiers.service.js';
import { VaccineStatusService } from './vaccine-status.service.js';

/**
 * Animales, clasificación, búsqueda e identificadores (M4a); salida, archivo y numeración
 * reutilizable (M4c).
 */
@Module({
  controllers: [AnimalsController, IdentifiersController],
  providers: [
    FarmContextService,
    VaccineStatusService,
    AnimalListService,
    AnimalSearchService,
    AnimalDetailService,
    AnimalsService,
    AnimalLifecycleService,
    IdentifiersService,
  ],
})
export class AnimalsModule {}
