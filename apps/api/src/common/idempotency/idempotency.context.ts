import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

/**
 * Petición en curso con encabezado `Idempotency-Key` (ADR-012 §2).
 *
 * La pone `IdempotencyInterceptor` en un `AsyncLocalStorage` y la consume
 * `TransactionsService.run`, que guarda la respuesta **en la misma transacción** que la acción.
 * Así el servicio no necesita saber nada del encabezado.
 */
export type IdempotentRequest = {
  readonly farmId: string;
  /** UUID en minúsculas. */
  readonly key: string;
  readonly method: string;
  /** Ruta pedida, con la query string. */
  readonly path: string;
  /** SHA-256 del método, la ruta y el cuerpo canónico. */
  readonly requestHash: string;
  /** Estado HTTP que tendrá la respuesta (el de la ruta: 201 en los `POST`). */
  readonly status: () => number;
  /** `true` cuando una transacción ya tomó la clave; las siguientes de la petición no la usan. */
  consumed: boolean;
};

export const idempotencyStorage = new AsyncLocalStorage<IdempotentRequest>();

/**
 * La respuesta ya estaba guardada: la acción no se repite. La lanza la transacción (o el
 * interceptor, antes de ejecutar nada) y el interceptor la convierte en la respuesta.
 */
export class IdempotentReplay extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super('Respuesta guardada de una Idempotency-Key');
    this.name = 'IdempotentReplay';
  }
}

/**
 * JSON con las claves de cada objeto ordenadas: dos cuerpos iguales con las claves en otro
 * orden son la misma petición.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(',')}}`;
}

/** Huella de la petición: método, ruta y cuerpo canónico. */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`)
    .digest('hex');
}
