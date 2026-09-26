/**
 * Identificadores UUIDv7 generados en la aplicación (ADR-11): ordenables por tiempo y
 * creables sin conexión desde el móvil (F2) sin riesgo de colisión.
 *
 * Estructura (RFC 9562): 48 bits de milisegundos Unix, 4 bits de versión (7),
 * 12 bits de contador, 2 bits de variante (10) y 62 bits aleatorios.
 *
 * El instante no es una fecha de negocio, así que no pasa por el servicio `Clock`
 * (ADR-002); se puede inyectar para que las pruebas sean deterministas.
 */

import { DomainError } from './errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_COUNTER = 0xfff;

/** Fuente de bytes aleatorios; por defecto la del entorno (Node, navegador o React Native). */
export type RandomBytes = (length: number) => Uint8Array;

/** Opciones de `uuidv7`. */
export type Uuidv7Options = {
  /** Milisegundos Unix. Por defecto, `Date.now()`. */
  readonly now?: number;
  /** Generador de bytes aleatorios. Por defecto, `crypto.getRandomValues`. */
  readonly random?: RandomBytes;
};

const defaultRandom: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

let lastTimestamp = -1;
let counter = 0;

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Genera un UUIDv7.
 *
 * Dentro de un mismo milisegundo, un contador de 12 bits garantiza que los identificadores
 * salgan en orden creciente; si el contador se agota se espera al milisegundo siguiente
 * avanzando la marca de tiempo, que es lo que recomienda el RFC.
 */
export function uuidv7(options: Uuidv7Options = {}): string {
  const random = options.random ?? defaultRandom;
  let timestamp = options.now ?? Date.now();

  if (timestamp <= lastTimestamp) {
    // Mismo milisegundo, o el reloj retrocedió (ajuste de NTP): se conserva la marca más
    // alta ya emitida y el contador garantiza que el identificador siga creciendo.
    timestamp = lastTimestamp;
    counter += 1;
    if (counter > MAX_COUNTER) {
      timestamp += 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }
  lastTimestamp = timestamp;

  const bytes = new Uint8Array(16);
  // 48 bits de marca de tiempo, big-endian.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
  // Versión 7 y los 12 bits del contador.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  const randomBytes = random(8);
  // Variante 10 en los dos bits más significativos.
  bytes[8] = 0x80 | ((randomBytes[0] ?? 0) & 0x3f);
  for (let i = 1; i < 8; i += 1) bytes[8 + i] = randomBytes[i] ?? 0;

  const text = hex(bytes);
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/** ¿El valor tiene la forma de un UUID en minúsculas? */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** ¿El valor es un UUID de versión 7? */
export function isUuidv7(value: string): boolean {
  return isUuid(value) && value[14] === '7';
}

/**
 * Milisegundos Unix codificados en un UUIDv7.
 * @throws {DomainError} `VALIDATION_FAILED` si no es un UUIDv7.
 */
export function uuidv7Timestamp(value: string): number {
  if (!isUuidv7(value)) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `El identificador «${value}» no es un UUID versión 7.`,
    });
  }
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}

/** Reinicia el contador monotónico. Solo para pruebas que necesitan un estado limpio. */
export function resetUuidv7State(): void {
  lastTimestamp = -1;
  counter = 0;
}
