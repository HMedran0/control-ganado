import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  addIdentifierSchema,
  bulkLotSchema,
  bulkTagsSchema,
  createAnimalSchema,
  listAnimalsQuerySchema,
  nextCodeQuerySchema,
  replaceIdentifierSchema,
  retireIdentifierSchema,
  searchAnimalsQuerySchema,
  updateAnimalSchema,
  type AddIdentifierInput,
  type AnimalDetail,
  type AnimalDetailWithWarnings,
  type AnimalList,
  type BulkLotInput,
  type BulkLotResult,
  type BulkTagsInput,
  type BulkTagsResult,
  type CreateAnimalInput,
  type Genealogy,
  type IdentifierView,
  type IsoDate,
  type ListAnimalsQuery,
  type NextCodeResult,
  type ReplaceIdentifierInput,
  type ReplaceIdentifierResult,
  type RetireIdentifierInput,
  type SearchAnimalsQuery,
  type SearchResult,
  type Timeline,
  type UpdateAnimalInput,
  type Warning,
} from '@hato/shared';
import { z } from 'zod';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { ZodBody, ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AnimalDetailService } from './animal-detail.service.js';
import { AnimalListService } from './animal-list.service.js';
import { AnimalSearchService } from './animal-search.service.js';
import { AnimalsService } from './animals.service.js';
import { IdentifiersService } from './identifiers.service.js';

const pageQuerySchema = z.object({ limit: z.string().optional(), cursor: z.string().optional() });
type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * Animales (05-api.md «Animales», ANI-01 a ANI-08, CLS-02). Todos los roles leen, registran y
 * editan (SRS §2.3); lo económico y «Disponible para venta» son solo de ADMIN, y eso lo decide
 * el servicio campo por campo (RN-20). La auditoría la escribe cada servicio dentro de su
 * transacción, no el interceptor.
 *
 * Las rutas fijas (`search`, `next-code`, `bulk/…`) se declaran antes que `:id`.
 */
@Controller('animals')
export class AnimalsController {
  constructor(
    private readonly listService: AnimalListService,
    private readonly searchService: AnimalSearchService,
    private readonly details: AnimalDetailService,
    private readonly animals: AnimalsService,
    private readonly identifiers: IdentifiersService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listAnimalsQuerySchema)) query: ListAnimalsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalList> {
    return this.listService.list(scope, query);
  }

  @Get('search')
  search(
    @Query(new ZodValidationPipe(searchAnimalsQuerySchema)) query: SearchAnimalsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<SearchResult> {
    return this.searchService.search(scope, query.q);
  }

  @Get('next-code')
  nextCode(
    @Query(new ZodValidationPipe(nextCodeQuerySchema)) query: { birthDate?: string },
    @CurrentScope() scope: FarmScope,
  ): Promise<NextCodeResult> {
    return this.details.nextCode(scope, query.birthDate as IsoDate | undefined);
  }

  @Post()
  create(
    @ZodBody(createAnimalSchema) body: CreateAnimalInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.animals.create(scope, body);
  }

  @Post('bulk/tags')
  bulkTags(
    @ZodBody(bulkTagsSchema) body: BulkTagsInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<BulkTagsResult> {
    return this.animals.bulkTags(scope, body);
  }

  @Post('bulk/lot')
  bulkLot(
    @ZodBody(bulkLotSchema) body: BulkLotInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<BulkLotResult> {
    return this.animals.bulkLot(scope, body);
  }

  @Get(':id')
  show(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetail> {
    return this.details.detail(scope, id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateAnimalSchema) body: UpdateAnimalInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.animals.update(scope, id, body);
  }

  @Get(':id/timeline')
  timeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<Timeline> {
    return this.details.timeline(scope, id, query);
  }

  @Get(':id/genealogy')
  genealogy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<Genealogy> {
    return this.details.genealogy(scope, id);
  }

  @Post(':id/identifiers')
  addIdentifier(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(addIdentifierSchema) body: AddIdentifierInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<IdentifierView & { readonly warnings: readonly Warning[] }> {
    return this.identifiers.add(scope, id, body);
  }
}

/** Identificadores (05-api.md «Identificadores», IDN-02). */
@Controller('identifiers')
export class IdentifiersController {
  constructor(private readonly identifiers: IdentifiersService) {}

  @Post(':id/replace')
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(replaceIdentifierSchema) body: ReplaceIdentifierInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ReplaceIdentifierResult> {
    return this.identifiers.replace(scope, id, body);
  }

  @Post(':id/retire')
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(retireIdentifierSchema) body: RetireIdentifierInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<IdentifierView> {
    return this.identifiers.retire(scope, id, body);
  }
}
