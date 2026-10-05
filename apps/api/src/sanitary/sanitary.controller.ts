import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ROLE,
  bulkVaccinationSchema,
  createTreatmentSchema,
  createVaccinationSchema,
  listTreatmentsQuerySchema,
  listVaccinationsQuerySchema,
  voidEventSchema,
  type BulkVaccinationInput,
  type BulkVaccinationResult,
  type CreateTreatmentInput,
  type CreateVaccinationInput,
  type CycleProgressView,
  type ListTreatmentsQuery,
  type ListVaccinationsQuery,
  type TreatmentList,
  type TreatmentView,
  type VaccinationList,
  type VaccinationView,
  type VaccinationWithWarnings,
  type VoidEventInput,
} from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody, ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TreatmentsService } from './treatments.service.js';
import { VaccinationsService } from './vaccinations.service.js';

/**
 * Vacunaciones (05-api.md «Sanidad», SAN-02, SAN-03). Todos los roles registran (SRS §2.3); anular
 * es de ADMIN y VET. La creación acepta el `id` del cliente; el lote y la anulación,
 * `Idempotency-Key` (ADR-012).
 */
@Controller('vaccinations')
export class VaccinationsController {
  constructor(private readonly vaccinations: VaccinationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listVaccinationsQuerySchema)) query: ListVaccinationsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<VaccinationList> {
    return this.vaccinations.list(scope, query);
  }

  @Post()
  create(
    @ZodBody(createVaccinationSchema) body: CreateVaccinationInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<VaccinationWithWarnings> {
    return this.vaccinations.create(scope, body);
  }

  /** `?dryRun=true`: el plan sin guardar (quiénes se vacunan, quiénes se omiten y por qué). */
  @Post('bulk')
  @Idempotent()
  bulk(
    @ZodBody(bulkVaccinationSchema) body: BulkVaccinationInput,
    @Query('dryRun') dryRun: string | undefined,
    @CurrentScope() scope: FarmScope,
  ): Promise<BulkVaccinationResult> {
    return this.vaccinations.bulk(scope, body, dryRun === 'true');
  }

  @Post(':id/void')
  @Roles(ROLE.ADMIN, ROLE.VET)
  @Idempotent()
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(voidEventSchema) body: VoidEventInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<VaccinationView> {
    return this.vaccinations.void(scope, id, body);
  }
}

/** Avance de un ciclo oficial (SAN-06 CA2). Los ciclos se editan en `CatalogsModule`. */
@Controller('vaccination-cycles')
export class CycleProgressController {
  constructor(private readonly vaccinations: VaccinationsService) {}

  @Get(':id/progress')
  progress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<CycleProgressView> {
    return this.vaccinations.cycleProgress(scope, id);
  }
}

/** Tratamientos (SAN-05). El costo solo lo registra y lo ve ADMIN (RN-20). */
@Controller('treatments')
export class TreatmentsController {
  constructor(private readonly treatments: TreatmentsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listTreatmentsQuerySchema)) query: ListTreatmentsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<TreatmentList> {
    return this.treatments.list(scope, query);
  }

  @Post()
  create(
    @ZodBody(createTreatmentSchema) body: CreateTreatmentInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<TreatmentView> {
    return this.treatments.create(scope, body);
  }

  @Post(':id/void')
  @Roles(ROLE.ADMIN, ROLE.VET)
  @Idempotent()
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(voidEventSchema) body: VoidEventInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<TreatmentView> {
    return this.treatments.void(scope, id, body);
  }
}
