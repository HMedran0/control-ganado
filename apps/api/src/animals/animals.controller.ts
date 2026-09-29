import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import {
  ROLE,
  addIdentifierSchema,
  archiveAnimalSchema,
  bulkLotSchema,
  bulkTagsSchema,
  createAnimalSchema,
  exitAnimalSchema,
  animalLabelsQuerySchema,
  listAnimalsQuerySchema,
  nextCodeQuerySchema,
  replaceIdentifierSchema,
  restoreAnimalSchema,
  retireIdentifierSchema,
  revertExitSchema,
  searchAnimalsQuerySchema,
  updateAnimalSchema,
  type AddIdentifierInput,
  type AnimalDetail,
  type AnimalDetailWithWarnings,
  type AnimalLabels,
  type AnimalLabelsQuery,
  type AnimalList,
  type ArchiveAnimalInput,
  type BulkLotInput,
  type BulkLotResult,
  type BulkTagsInput,
  type BulkTagsResult,
  type CreateAnimalInput,
  type ExitAnimalInput,
  type Genealogy,
  type IdentifierView,
  type IsoDate,
  type ListAnimalsQuery,
  type NextCodeResult,
  type ReplaceIdentifierInput,
  type ReplaceIdentifierResult,
  type RestoreAnimalInput,
  type RetireIdentifierInput,
  type RevertExitInput,
  type SearchAnimalsQuery,
  type SearchResult,
  type Timeline,
  type UpdateAnimalInput,
  type Warning,
} from '@hato/shared';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody, ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AnimalDetailService } from './animal-detail.service.js';
import { AnimalExportService, XLSX_CONTENT_TYPE } from './animal-export.service.js';
import { AnimalLabelsService } from './animal-labels.service.js';
import { AnimalLifecycleService } from './animal-lifecycle.service.js';
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
 *
 * Las acciones que no son creaciones aceptan `Idempotency-Key` (`@Idempotent()`, ADR-012 §2);
 * las creaciones aceptan el `id` del cliente (ADR-012 §1).
 */
@Controller('animals')
export class AnimalsController {
  constructor(
    private readonly listService: AnimalListService,
    private readonly searchService: AnimalSearchService,
    private readonly details: AnimalDetailService,
    private readonly animals: AnimalsService,
    private readonly lifecycle: AnimalLifecycleService,
    private readonly identifiers: IdentifiersService,
    private readonly exporter: AnimalExportService,
    private readonly labelService: AnimalLabelsService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listAnimalsQuerySchema)) query: ListAnimalsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalList> {
    return this.listService.list(scope, query);
  }

  /**
   * El listado en Excel, con los mismos filtros que `GET /animals` y sin paginar (ANI-06 CA4).
   * El valor de compra solo va para ADMIN (RN-20).
   */
  @Get('export.xlsx')
  async export(
    @Query(new ZodValidationPipe(listAnimalsQuerySchema)) query: ListAnimalsQuery,
    @CurrentScope() scope: FarmScope,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.exporter.export(scope, query);
    reply.header('content-type', XLSX_CONTENT_TYPE);
    reply.header('content-disposition', `attachment; filename="${file.fileName}"`);
    reply.header('cache-control', 'no-store');
    return file.data;
  }

  /** Hoja de etiquetas con QR para imprimir desde el navegador (IDN-03 CA2, solo ADMIN). */
  @Roles(ROLE.ADMIN)
  @Get('labels')
  labels(
    @Query(new ZodValidationPipe(animalLabelsQuerySchema)) query: AnimalLabelsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalLabels> {
    return this.labelService.labels(scope, query);
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
    @Query(new ZodValidationPipe(nextCodeQuerySchema))
    query: { birthDate?: string; count?: number },
    @CurrentScope() scope: FarmScope,
  ): Promise<NextCodeResult> {
    return this.details.nextCode(scope, query.birthDate as IsoDate | undefined, query.count);
  }

  @Post()
  create(
    @ZodBody(createAnimalSchema) body: CreateAnimalInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.animals.create(scope, body);
  }

  @Post('bulk/tags')
  @Idempotent()
  bulkTags(
    @ZodBody(bulkTagsSchema) body: BulkTagsInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<BulkTagsResult> {
    return this.animals.bulkTags(scope, body);
  }

  @Post('bulk/lot')
  @Idempotent()
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

  @Post(':id/exit')
  @Roles(ROLE.ADMIN)
  @Idempotent()
  exit(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(exitAnimalSchema) body: ExitAnimalInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.lifecycle.exit(scope, id, body);
  }

  @Post(':id/revert-exit')
  @Roles(ROLE.ADMIN)
  @Idempotent()
  revertExit(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(revertExitSchema) body: RevertExitInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.lifecycle.revertExit(scope, id, body);
  }

  @Post(':id/archive')
  @Roles(ROLE.ADMIN)
  @Idempotent()
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(archiveAnimalSchema) body: ArchiveAnimalInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.lifecycle.archive(scope, id, body);
  }

  @Post(':id/restore')
  @Roles(ROLE.ADMIN)
  @Idempotent()
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(restoreAnimalSchema) body: RestoreAnimalInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalDetailWithWarnings> {
    return this.lifecycle.restore(scope, id, body);
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
  @Idempotent()
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(replaceIdentifierSchema) body: ReplaceIdentifierInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ReplaceIdentifierResult> {
    return this.identifiers.replace(scope, id, body);
  }

  @Post(':id/retire')
  @Idempotent()
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(retireIdentifierSchema) body: RetireIdentifierInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<IdentifierView> {
    return this.identifiers.retire(scope, id, body);
  }
}
