import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ClientIdReplayInterceptor } from './client-id.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyPurgeService } from './idempotency-purge.service.js';
import { TransactionsService } from './transactions.service.js';

/**
 * Escrituras listas para trabajar sin conexión (ADR-012): transacciones con `Idempotency-Key`,
 * su purga y el 200 de las creaciones repetidas con el mismo `id` del cliente.
 */
@Global()
@Module({
  providers: [
    TransactionsService,
    IdempotencyInterceptor,
    IdempotencyPurgeService,
    { provide: APP_INTERCEPTOR, useClass: ClientIdReplayInterceptor },
  ],
  exports: [TransactionsService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
