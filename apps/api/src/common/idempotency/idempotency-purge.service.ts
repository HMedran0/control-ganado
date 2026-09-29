import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Logger } from 'pino';

import { LOGGER } from '../../infra/logger.js';
import { TransactionsService } from './transactions.service.js';

/** Cada cuánto se purgan las claves vencidas mientras la API corre. */
export const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Purga de `idempotency_keys` (ADR-012 §2): al arrancar la API y cada seis horas se borran las
 * respuestas de más de 7 días. Mientras tanto, `TransactionsService.findValid` ya ignora las
 * vencidas, así que la hora exacta de la purga no cambia ninguna respuesta.
 */
@Injectable()
export class IdempotencyPurgeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly transactions: TransactionsService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.purge();
    this.timer = setInterval(() => void this.purge(), PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async purge(): Promise<void> {
    try {
      const count = await this.transactions.purgeExpired();
      if (count > 0) this.logger.info({ count }, 'Claves de idempotencia vencidas purgadas');
    } catch (error) {
      this.logger.error({ err: error }, 'No se pudieron purgar las claves de idempotencia');
    }
  }
}
