import { Injectable } from '@nestjs/common';
import { DomainError, IDEMPOTENCY_KEY_TTL_DAYS, uuidv7 } from '@hato/shared';

import { Prisma } from '../../generated/prisma/client.js';
import { Clock } from '../../infra/clock.service.js';
import { PrismaService } from '../../infra/prisma.service.js';
import type { Tx } from '../persistence.js';
import { isReplayed } from './client-id.js';
import {
  IdempotentReplay,
  idempotencyStorage,
  type IdempotentRequest,
} from './idempotency.context.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Opciones de la transacción interactiva de Prisma. */
export type TransactionOptions = { readonly maxWait?: number; readonly timeout?: number };

/**
 * Transacciones de las escrituras de negocio (ADR-012 §2).
 *
 * Es `prisma.$transaction` más una cosa: si la petición trae `Idempotency-Key` (lo decide
 * `@Idempotent()` en el controlador), dentro de la misma transacción
 *
 * 1. toma un candado consultivo por (finca, clave): dos reintentos simultáneos se esperan entre
 *    sí, pero dos acciones con claves distintas de la misma finca no (el candado por finca es
 *    solo de la importación, ADR-011);
 * 2. busca la clave: si ya existe con la misma huella, devuelve la respuesta guardada sin repetir
 *    la acción; con otra huella, `IDEMPOTENCY_KEY_REUSED`;
 * 3. ejecuta la acción y guarda su respuesta. Si la acción falla, no queda nada guardado y el
 *    reintento la vuelve a intentar.
 *
 * Por eso lo que devuelve `fn` debe ser la respuesta completa del endpoint.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  run<T>(fn: (tx: Tx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const request = idempotencyStorage.getStore();
    if (request === undefined || request.consumed) return this.prisma.$transaction(fn, options);
    request.consumed = true;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended('idempotency:' || ${request.farmId}::text || ':' || ${request.key}::text, 0))`;
      const stored = await this.findValid(tx, request);
      if (stored !== null) throw replayOf(stored, request);

      const result = await fn(tx);
      await tx.idempotencyKey.create({
        data: {
          id: uuidv7(),
          farmId: request.farmId,
          key: request.key,
          method: request.method,
          path: request.path,
          requestHash: request.requestHash,
          responseStatus: isReplayed(result) ? 200 : request.status(),
          responseBody: toJsonValue(result),
          createdAt: this.clock.now(),
        },
      });
      return result;
    }, options);
  }

  /**
   * Respuesta guardada de la clave, si sigue vigente. Una de más de 7 días que la purga aún no
   * borró se descarta aquí, como si no existiera.
   */
  async findValid(
    db: Tx,
    request: Pick<IdempotentRequest, 'farmId' | 'key'>,
  ): Promise<StoredResponse | null> {
    const stored = await db.idempotencyKey.findUnique({
      where: { farmId_key: { farmId: request.farmId, key: request.key } },
      select: {
        id: true,
        requestHash: true,
        responseStatus: true,
        responseBody: true,
        createdAt: true,
      },
    });
    if (stored === null) return null;
    if (
      this.clock.now().getTime() - stored.createdAt.getTime() >
      IDEMPOTENCY_KEY_TTL_DAYS * DAY_MS
    ) {
      await db.idempotencyKey.delete({ where: { id: stored.id } });
      return null;
    }
    return stored;
  }

  /** Borra las claves de más de 7 días. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - IDEMPOTENCY_KEY_TTL_DAYS * DAY_MS);
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}

/** Fila guardada de `idempotency_keys`. */
export type StoredResponse = {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: Prisma.JsonValue;
};

/** La respuesta guardada, o `IDEMPOTENCY_KEY_REUSED` si la clave vino con otra petición. */
export function replayOf(stored: StoredResponse, request: IdempotentRequest): IdempotentReplay {
  if (stored.requestHash !== request.requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED');
  return new IdempotentReplay(stored.responseStatus, stored.responseBody);
}

/** La respuesta tal como viajaría en JSON (sin `undefined` ni instancias de clases). */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
