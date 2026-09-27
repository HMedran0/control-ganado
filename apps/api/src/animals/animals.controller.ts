import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  listAnimalsQuerySchema,
  nextCodeQuerySchema,
  searchAnimalsQuerySchema,
  type AnimalDetail,
  type AnimalList,
  type Genealogy,
  type IsoDate,
  type ListAnimalsQuery,
  type NextCodeResult,
  type SearchAnimalsQuery,
  type SearchResult,
  type Timeline,
} from '@hato/shared';
import { z } from 'zod';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AnimalDetailService } from './animal-detail.service.js';
import { AnimalListService } from './animal-list.service.js';
import { AnimalSearchService } from './animal-search.service.js';

const pageQuerySchema = z.object({ limit: z.string().optional(), cursor: z.string().optional() });
type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * Animales (05-api.md «Animales», ANI-05 a ANI-08): consultas. Todos los roles leen (SRS §2.3);
 * los datos económicos de la ficha solo viajan para ADMIN (RN-20).
 *
 * Las rutas fijas (`search`, `next-code`) se declaran antes que `:id`.
 */
@Controller('animals')
export class AnimalsController {
  constructor(
    private readonly listService: AnimalListService,
    private readonly searchService: AnimalSearchService,
    private readonly details: AnimalDetailService,
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

  @Get(':id')
  show(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetail> {
    return this.details.detail(scope, id);
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
}
