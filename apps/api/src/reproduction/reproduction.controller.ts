import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ROLE,
  abortionSchema,
  birthsReportQuerySchema,
  calvingSchema,
  createPregnancySchema,
  diagnosisSchema,
  listPregnanciesQuerySchema,
  updatePregnancySchema,
  voidPregnancySchema,
  type AbortionInput,
  type BirthsReport,
  type BirthsReportQuery,
  type CalvingInput,
  type CalvingResult,
  type CreatePregnancyInput,
  type DiagnosisInput,
  type ListPregnanciesQuery,
  type PregnancyList,
  type PregnancyView,
  type PregnancyWithWarnings,
  type UpdatePregnancyInput,
  type VoidPregnancyInput,
} from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody, ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { BirthsReportService } from './births-report.service.js';
import { CalvingsService } from './calvings.service.js';
import { PregnanciesService } from './pregnancies.service.js';

/**
 * Reproducción (05-api.md «Reproducción», REP-01 a REP-05). Todos los roles registran servicios,
 * palpaciones, abortos y partos (SRS §2.3); anular es solo de ADMIN.
 *
 * La creación del servicio acepta el `id` del cliente; las acciones sobre una preñez y el parto
 * aceptan `Idempotency-Key` (ADR-012).
 */
@Controller('pregnancies')
export class PregnanciesController {
  constructor(private readonly pregnancies: PregnanciesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listPregnanciesQuerySchema)) query: ListPregnanciesQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyList> {
    return this.pregnancies.list(scope, query);
  }

  @Post()
  create(
    @ZodBody(createPregnancySchema) body: CreatePregnancyInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyWithWarnings> {
    return this.pregnancies.create(scope, body);
  }

  @Get(':id')
  show(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyView> {
    return this.pregnancies.get(scope, id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updatePregnancySchema) body: UpdatePregnancyInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyWithWarnings> {
    return this.pregnancies.update(scope, id, body);
  }

  @Post(':id/diagnosis')
  @Idempotent()
  diagnose(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(diagnosisSchema) body: DiagnosisInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyWithWarnings> {
    return this.pregnancies.diagnose(scope, id, body);
  }

  @Post(':id/abortion')
  @Idempotent()
  abort(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(abortionSchema) body: AbortionInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyWithWarnings> {
    return this.pregnancies.abort(scope, id, body);
  }

  @Post(':id/void')
  @Roles(ROLE.ADMIN)
  @Idempotent()
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(voidPregnancySchema) body: VoidPregnancyInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<PregnancyView> {
    return this.pregnancies.void(scope, id, body);
  }
}

/** Parto (REP-04, CU-01). */
@Controller('calvings')
export class CalvingsController {
  constructor(private readonly calvings: CalvingsService) {}

  @Post()
  @Idempotent()
  calve(
    @ZodBody(calvingSchema) body: CalvingInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<CalvingResult> {
    return this.calvings.calve(scope, body);
  }
}

/** Reporte de nacimientos (NAC-01). */
@Controller('reports')
export class BirthsReportController {
  constructor(private readonly births: BirthsReportService) {}

  @Get('births')
  report(
    @Query(new ZodValidationPipe(birthsReportQuerySchema)) query: BirthsReportQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<BirthsReport> {
    return this.births.report(scope, query);
  }
}
