import { Controller, Get, HttpCode } from '@nestjs/common';

import { Public } from '../common/farm-scope/public.decorator.js';
import { HealthService, type HealthReport } from './health.service.js';

/**
 * `GET /health` — estado de la API y de la base de datos (04-arquitectura.md §11).
 *
 * Público: lo consultan el contenedor, el proxy y la supervisión, que no tienen sesión.
 * No revela versiones ni cadenas de conexión.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  @HttpCode(200)
  async check(): Promise<HealthReport> {
    return this.health.check();
  }
}
