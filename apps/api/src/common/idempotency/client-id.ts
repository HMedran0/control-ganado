import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { DomainError } from '@hato/shared';
import type { FastifyReply } from 'fastify';
import { tap, type Observable } from 'rxjs';

import { canonicalJson } from './idempotency.context.js';

/**
 * `id` del cliente en las creaciones (ADR-012 §1).
 *
 * Si el registro ya existe en la finca con **el mismo contenido**, la creación responde 200 con
 * él, sin duplicar; con otro contenido, o si el `id` es de otra finca, `CLIENT_ID_CONFLICT`.
 * «Mismo contenido» compara los campos que trae la petición, normalizados como los guarda la
 * API, con los guardados.
 */

const REPLAYED = Symbol('client-id-replayed');

/**
 * Marca la respuesta de una creación repetida: `ClientIdReplayInterceptor` le pone 200 en lugar
 * del 201. La marca no es enumerable, así que no viaja en el JSON.
 */
export function asReplayed<T extends object>(value: T): T {
  Object.defineProperty(value, REPLAYED, { value: true, enumerable: false });
  return value;
}

/** ¿Es la respuesta de una creación repetida? */
export function isReplayed(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[REPLAYED] === true
  );
}

/** Cambia el 201 por 200 cuando la creación ya existía (global). */
@Injectable()
export class ClientIdReplayInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      tap((value) => {
        if (isReplayed(value)) void reply.status(200);
      }),
    );
  }
}

/** El `id` ya existe, pero en otra finca o con otros datos. */
export function clientIdConflict(): DomainError {
  return new DomainError('CLIENT_ID_CONFLICT', {
    fieldErrors: { id: ['Ya existe un registro con ese identificador y otros datos.'] },
  });
}

/**
 * Compara, campo por campo, lo que trae la petición (ya normalizado como se guardaría) con lo
 * guardado. Los campos `undefined` de la petición no se comparan: el cliente no los envió.
 *
 * @throws {DomainError} `CLIENT_ID_CONFLICT` si algún campo difiere.
 */
export function assertSameContent(
  requested: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
): void {
  for (const [field, value] of Object.entries(requested)) {
    if (value === undefined) continue;
    if (canonicalJson(value) !== canonicalJson(stored[field] ?? null)) throw clientIdConflict();
  }
}

/**
 * Busca un `id` del cliente en toda la base, no solo en la finca: un `id` de otra finca también
 * es conflicto (no se crea un duplicado con el mismo UUID, ni se revela nada de la otra finca).
 *
 * @returns `null` si no existe (crear), o el registro de esta finca (comparar el contenido).
 * @throws {DomainError} `CLIENT_ID_CONFLICT` si es de otra finca.
 */
export function ownRecordOrConflict<T extends { readonly farmId: string }>(
  existing: T | null,
  farmId: string,
): T | null {
  if (existing === null) return null;
  if (existing.farmId !== farmId) throw clientIdConflict();
  return existing;
}
