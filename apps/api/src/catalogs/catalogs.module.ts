import { Module } from '@nestjs/common';

import { BreedsService } from './breeds.service.js';
import {
  BreedsController,
  CyclesController,
  LotsController,
  TagsController,
  VaccinesController,
} from './catalogs.controllers.js';
import { CyclesService } from './cycles.service.js';
import { FarmController } from './farm.controller.js';
import { FarmService } from './farm.service.js';
import { LotsService } from './lots.service.js';
import { TagsService } from './tags.service.js';
import { VaccinesService } from './vaccines.service.js';

/** Finca y catálogos (M3: CFG-01, CFG-02, SAN-01, SAN-06). */
@Module({
  controllers: [
    FarmController,
    BreedsController,
    VaccinesController,
    CyclesController,
    LotsController,
    TagsController,
  ],
  providers: [FarmService, BreedsService, VaccinesService, CyclesService, LotsService, TagsService],
})
export class CatalogsModule {}
