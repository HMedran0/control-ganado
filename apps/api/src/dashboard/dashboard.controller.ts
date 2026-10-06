import { Controller, Get } from '@nestjs/common';
import type { DashboardResponse } from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Tablero de Inicio (RPT-01, M8a). Lo ven todos los roles; la inversión del hato solo llega al
 * ADMIN (RN-20), y el barrido de `rn20-sweep.e2e-spec.ts` lo revisa como a toda ruta `GET`.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentScope() scope: FarmScope): Promise<DashboardResponse> {
    return this.dashboard.dashboard(scope);
  }
}
