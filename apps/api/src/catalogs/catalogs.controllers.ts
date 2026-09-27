import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createBreedSchema,
  createCycleSchema,
  createLotSchema,
  createTagSchema,
  createVaccineSchema,
  ROLE,
  updateBreedSchema,
  updateCycleSchema,
  updateLotSchema,
  updateTagSchema,
  updateVaccineSchema,
  type BreedView,
  type CatalogList,
  type CreateBreedInput,
  type CreateCycleInput,
  type CreateLotInput,
  type CreateTagInput,
  type CreateVaccineInput,
  type CycleView,
  type DeactivationWarnings,
  type LotView,
  type TagView,
  type UpdateBreedInput,
  type UpdateCycleInput,
  type UpdateLotInput,
  type UpdateTagInput,
  type UpdateVaccineInput,
  type VaccineView,
  type WithWarnings,
} from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody } from '../common/validation/zod-validation.pipe.js';
import { BreedsService } from './breeds.service.js';
import { parseIncludeInactive } from './catalog-support.js';
import { CyclesService } from './cycles.service.js';
import { LotsService } from './lots.service.js';
import { TagsService } from './tags.service.js';
import { VaccinesService } from './vaccines.service.js';

/**
 * Catálogos de la finca (05-api.md «Usuarios y finca», matriz de permisos del SRS §2.3):
 * todos los roles leen; ADMIN escribe; VET también escribe vacunas. No hay `DELETE`: los
 * catálogos se desactivan con `PATCH { isActive: false }` y conservan su historial (RN-11).
 *
 * `?includeInactive=true` incluye los desactivados; sin él, solo los que ofrecen los
 * formularios.
 */

@Controller('breeds')
export class BreedsController {
  constructor(private readonly breeds: BreedsService) {}

  @Get()
  list(
    @CurrentScope() scope: FarmScope,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<CatalogList<BreedView>> {
    return this.breeds.list(scope, parseIncludeInactive(includeInactive));
  }

  @Roles(ROLE.ADMIN)
  @Post()
  create(
    @ZodBody(createBreedSchema) body: CreateBreedInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<BreedView> {
    return this.breeds.create(scope, body);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateBreedSchema) body: UpdateBreedInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<BreedView> {
    return this.breeds.update(scope, id, body);
  }
}

@Controller('vaccines')
export class VaccinesController {
  constructor(private readonly vaccines: VaccinesService) {}

  @Get()
  list(
    @CurrentScope() scope: FarmScope,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<CatalogList<VaccineView>> {
    return this.vaccines.list(scope, parseIncludeInactive(includeInactive));
  }

  @Roles(ROLE.ADMIN, ROLE.VET)
  @Post()
  create(
    @ZodBody(createVaccineSchema) body: CreateVaccineInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<VaccineView> {
    return this.vaccines.create(scope, body);
  }

  @Roles(ROLE.ADMIN, ROLE.VET)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateVaccineSchema) body: UpdateVaccineInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<WithWarnings<VaccineView>> {
    return this.vaccines.update(scope, id, body);
  }

  @Roles(ROLE.ADMIN, ROLE.VET)
  @Get(':id/deactivation-warnings')
  deactivationWarnings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<DeactivationWarnings> {
    return this.vaccines.deactivationWarnings(scope, id);
  }
}

@Controller('vaccination-cycles')
export class CyclesController {
  constructor(private readonly cycles: CyclesService) {}

  @Get()
  list(
    @CurrentScope() scope: FarmScope,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<CatalogList<CycleView>> {
    return this.cycles.list(scope, parseIncludeInactive(includeInactive));
  }

  @Roles(ROLE.ADMIN)
  @Post()
  create(
    @ZodBody(createCycleSchema) body: CreateCycleInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<WithWarnings<CycleView>> {
    return this.cycles.create(scope, body);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateCycleSchema) body: UpdateCycleInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<WithWarnings<CycleView>> {
    return this.cycles.update(scope, id, body);
  }
}

@Controller('lots')
export class LotsController {
  constructor(private readonly lots: LotsService) {}

  @Get()
  list(
    @CurrentScope() scope: FarmScope,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<CatalogList<LotView>> {
    return this.lots.list(scope, parseIncludeInactive(includeInactive));
  }

  @Roles(ROLE.ADMIN)
  @Post()
  create(
    @ZodBody(createLotSchema) body: CreateLotInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<LotView> {
    return this.lots.create(scope, body);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateLotSchema) body: UpdateLotInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<WithWarnings<LotView>> {
    return this.lots.update(scope, id, body);
  }

  @Roles(ROLE.ADMIN)
  @Get(':id/deactivation-warnings')
  deactivationWarnings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<DeactivationWarnings> {
    return this.lots.deactivationWarnings(scope, id);
  }
}

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(
    @CurrentScope() scope: FarmScope,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<CatalogList<TagView>> {
    return this.tags.list(scope, parseIncludeInactive(includeInactive));
  }

  @Roles(ROLE.ADMIN)
  @Post()
  create(
    @ZodBody(createTagSchema) body: CreateTagInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<TagView> {
    return this.tags.create(scope, body);
  }

  @Roles(ROLE.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateTagSchema) body: UpdateTagInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<TagView> {
    return this.tags.update(scope, id, body);
  }
}
