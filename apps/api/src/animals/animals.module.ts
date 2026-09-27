import { Module } from '@nestjs/common';

import { FarmContextService } from './farm-context.service.js';

/** Animales, clasificación, búsqueda e identificadores (M4a). */
@Module({
  providers: [FarmContextService],
})
export class AnimalsModule {}
