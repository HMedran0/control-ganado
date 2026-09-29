import { UseInterceptors, applyDecorators } from '@nestjs/common';

import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/**
 * Marca una acción que no es una creación (salida, archivo, anulación, operación en lote…) para
 * que acepte `Idempotency-Key` (ADR-012 §2). Su servicio escribe con `TransactionsService.run` y
 * devuelve desde la transacción la respuesta completa del endpoint.
 */
export const Idempotent = (): MethodDecorator =>
  applyDecorators(UseInterceptors(IdempotencyInterceptor));
