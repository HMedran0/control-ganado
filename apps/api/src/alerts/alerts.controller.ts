import { Controller, Get, Query } from '@nestjs/common';
import { alertsQuerySchema, type AlertsQuery, type AlertsResponse } from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AlertsService } from './alerts.service.js';

/** Página de Alertas (M6): todos los roles la ven. Sin datos económicos. */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(alertsQuerySchema)) query: AlertsQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<AlertsResponse> {
    return this.alerts.list(scope, query);
  }
}
