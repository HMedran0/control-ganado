import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  DomainError,
  ROLE,
  createScaleProfileSchema,
  createWeightSchema,
  duplicateScaleTemplateSchema,
  updateScaleProfileSchema,
  voidEventSchema,
  weightImportFieldsSchema,
  type AnimalWeights,
  type CreateScaleProfileInput,
  type CreateWeightInput,
  type DuplicateScaleTemplateInput,
  type ScaleProfileList,
  type ScaleProfileView,
  type UpdateScaleProfileInput,
  type VoidEventInput,
  type WeightImportDryRun,
  type WeightImportFields,
  type WeightImportResult,
  type WeightView,
  type WeightWithWarnings,
} from '@hato/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody } from '../common/validation/zod-validation.pipe.js';
import { readUpload } from '../imports/upload.js';
import { ScaleProfilesService } from './scale-profiles.service.js';
import { WeightImportService } from './weight-import.service.js';
import { WeightsService } from './weights.service.js';

/**
 * Pesajes (05-api.md «Pesos y lotes», PES-01, PES-04). Todos los roles registran e importan la
 * sesión de la báscula (SRS §2.3). Anular: quien lo registró en 24 horas, o ADMIN.
 */
@Controller('weights')
export class WeightsController {
  constructor(
    private readonly weights: WeightsService,
    private readonly imports: WeightImportService,
  ) {}

  @Post()
  create(
    @ZodBody(createWeightSchema) body: CreateWeightInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<WeightWithWarnings> {
    return this.weights.create(scope, body);
  }

  @Post(':id/void')
  @Idempotent()
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(voidEventSchema) body: VoidEventInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<WeightView> {
    return this.weights.void(scope, id, body);
  }

  /**
   * `?dryRun=true`: la simulación (PES-04 CA2), no guarda nada. Sin él, crea la jornada de pesaje
   * con un pesaje por animal, una sola vez por `importKey` (ADR-011).
   */
  @Post('import')
  @HttpCode(201)
  async import(
    @Query('dryRun') dryRun: string | undefined,
    @CurrentScope() scope: FarmScope,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WeightImportDryRun | WeightImportResult> {
    const { file, fields } = await readUpload(request);
    const parsed = parseFields(fields);
    if (dryRun === 'true') {
      reply.status(200);
      return this.imports.preview(scope, file, parsed);
    }
    const result = await this.imports.confirm(scope, file, parsed);
    if (result.replayed) reply.status(200);
    return result;
  }
}

/** Serie de pesos y ganancia de un animal (PES-02, PES-05). */
@Controller('animals')
export class AnimalWeightsController {
  constructor(private readonly weights: WeightsService) {}

  @Get(':id/weights')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<AnimalWeights> {
    return this.weights.forAnimal(scope, id);
  }
}

/**
 * Perfiles de báscula (PES-04 CA1): todos los ven; solo ADMIN crea, edita y duplica. Las
 * plantillas del sistema no se editan (`SYSTEM_TEMPLATE_READONLY`).
 */
@Controller('scale-profiles')
export class ScaleProfilesController {
  constructor(private readonly profiles: ScaleProfilesService) {}

  @Get()
  list(@CurrentScope() scope: FarmScope): Promise<ScaleProfileList> {
    return this.profiles.list(scope);
  }

  @Post()
  @Roles(ROLE.ADMIN)
  create(
    @ZodBody(createScaleProfileSchema) body: CreateScaleProfileInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ScaleProfileView> {
    return this.profiles.create(scope, body);
  }

  @Patch(':id')
  @Roles(ROLE.ADMIN)
  update(
    @Param('id') id: string,
    @ZodBody(updateScaleProfileSchema) body: UpdateScaleProfileInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ScaleProfileView> {
    return this.profiles.update(scope, id, body);
  }

  @Post(':templateKey/duplicate')
  @Roles(ROLE.ADMIN)
  duplicate(
    @Param('templateKey') templateKey: string,
    @ZodBody(duplicateScaleTemplateSchema) body: DuplicateScaleTemplateInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<ScaleProfileView> {
    return this.profiles.duplicate(scope, templateKey, body);
  }
}

/** Valida los campos de texto del formulario con su esquema de shared. */
function parseFields(fields: Record<string, string>): WeightImportFields {
  const parsed = weightImportFieldsSchema.safeParse(fields);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || 'form';
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  throw new DomainError('VALIDATION_FAILED', { fieldErrors });
}
