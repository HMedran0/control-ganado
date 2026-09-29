import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { DomainError, IDEMPOTENCY_KEY_HEADER, isUuid } from '@hato/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { Observable, catchError, of, tap, throwError } from 'rxjs';

import { LOGGER } from '../../infra/logger.js';
import { PrismaService } from '../../infra/prisma.service.js';
import type { RequestWithScope } from '../farm-scope/farm-scope.types.js';
import {
  IdempotentReplay,
  idempotencyStorage,
  requestHash,
  type IdempotentRequest,
} from './idempotency.context.js';
import { TransactionsService, replayOf } from './transactions.service.js';

const HEADER = IDEMPOTENCY_KEY_HEADER.toLowerCase();

/**
 * `Idempotency-Key` en las acciones marcadas con `@Idempotent()` (ADR-012 §2).
 *
 * Sin el encabezado, la petición sigue igual. Con él:
 *
 * - valida que sea un UUID;
 * - si la respuesta ya está guardada, la devuelve sin ejecutar nada (la misma comprobación se
 *   repite con candado dentro de la transacción, en `TransactionsService.run`);
 * - si no, ejecuta la acción con la petición en el contexto, y la transacción de la acción
 *   guarda la respuesta.
 *
 * Solo lo usan las rutas decoradas: `/auth` nunca lo lleva (sus respuestas tienen tokens).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & RequestWithScope>();
    const reply = http.getResponse<FastifyReply>();
    const header = request.headers[HEADER];
    if (header === undefined) return next.handle();

    const key = (Array.isArray(header) ? header[0] : header)?.trim().toLowerCase() ?? '';
    if (!isUuid(key)) {
      throw new DomainError('VALIDATION_FAILED', {
        detail: 'El encabezado Idempotency-Key debe ser un UUID.',
        fieldErrors: { [IDEMPOTENCY_KEY_HEADER]: ['Debe ser un UUID.'] },
      });
    }
    const scope = request.scope;
    if (scope === undefined) {
      throw new DomainError('FORBIDDEN_ROLE', {
        detail: 'La petición no tiene una finca asociada.',
      });
    }

    const pending: IdempotentRequest = {
      farmId: scope.farmId,
      key,
      method: request.method,
      path: request.url,
      requestHash: requestHash(request.method, request.url, request.body),
      status: () => reply.statusCode,
      consumed: false,
    };

    const respond = (replay: IdempotentReplay): Observable<unknown> => {
      void reply.status(replay.status);
      return of(replay.body);
    };

    const stored = await this.transactions.findValid(this.prisma, pending);
    if (stored !== null) return respond(replayOf(stored, pending));

    return new Observable<unknown>((subscriber) =>
      idempotencyStorage.run(pending, () =>
        next
          .handle()
          .pipe(
            catchError((error: unknown) =>
              error instanceof IdempotentReplay ? respond(error) : throwError(() => error),
            ),
            tap(() => {
              if (!pending.consumed) {
                this.logger.error(
                  { path: pending.path },
                  'Acción con Idempotency-Key que no pasó por TransactionsService.run: su respuesta no se guardó',
                );
              }
            }),
          )
          .subscribe(subscriber),
      ),
    );
  }
}
