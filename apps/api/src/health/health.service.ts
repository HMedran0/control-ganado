import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { IsoDate } from '@hato/shared';

import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Respuesta de `GET /health`. */
export type HealthReport = {
  readonly status: 'ok';
  readonly database: 'ok';
  /** Fecha de negocio de hoy según el `Clock`, útil para detectar un `SEED_TODAY` olvidado. */
  readonly today: IsoDate;
  /** `true` si «hoy» está fijado por `SEED_TODAY`. */
  readonly clockFixed: boolean;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Comprueba la API y la conexión a la base de datos.
   *
   * @throws {ServiceUnavailableException} 503 si la base de datos no responde: un 200 con
   *   `database: 'error'` haría que el supervisor considerara sana una API que no sirve.
   */
  async check(): Promise<HealthReport> {
    try {
      await this.prisma.ping();
    } catch (cause) {
      throw new ServiceUnavailableException({
        detail: 'La base de datos no responde.',
        cause,
      });
    }

    return {
      status: 'ok',
      database: 'ok',
      today: this.clock.today(),
      clockFixed: this.clock.isFixed(),
    };
  }
}
