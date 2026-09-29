/**
 * Identificadores y marcas de tiempo deterministas del seed.
 *
 * Los IDs son UUIDv7 de verdad (los genera `uuidv7` de `@hato/shared`, CLAUDE.md regla 8),
 * pero ni la marca de tiempo ni la parte aleatoria salen del entorno:
 *
 * - la marca de tiempo es un contador que arranca en `SEED_EPOCH_MS` y avanza un milisegundo
 *   por identificador, así que es estrictamente creciente y el contador interno de `uuidv7`
 *   se reinicia en cada llamada;
 * - los ocho bytes aleatorios vienen del generador con semilla.
 *
 * Consecuencia: dos ejecuciones del seed producen los mismos identificadores, en el mismo
 * orden, sin depender del reloj de la máquina.
 */

import { createHash } from 'node:crypto';

import { resetUuidv7State, uuidv7 } from '@hato/shared';

import type { SeededRandom } from './random.js';

/**
 * Origen de las marcas de tiempo de los identificadores: 2020-01-01T00:00:00Z.
 *
 * Es una fecha arbitraria y anterior a cualquier dato del seed. No representa nada del
 * negocio: la fecha de cada hecho vive en su columna `date`, no en el UUID.
 */
export const SEED_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Fábrica de identificadores del seed. */
export type IdFactory = {
  /** Siguiente UUIDv7. */
  next(): string;
  /** Cuántos se han generado. */
  count(): number;
};

/**
 * Crea la fábrica y **reinicia el estado global de `uuidv7`**, para que el resultado no
 * dependa de lo que se haya generado antes en el mismo proceso (importa en las pruebas, que
 * crean datos con `uuidv7` y después ejecutan el seed).
 */
export function createIdFactory(random: SeededRandom, epochOffsetMs = 0): IdFactory {
  resetUuidv7State();
  let generated = 0;

  return {
    next: () => {
      const id = uuidv7({
        now: SEED_EPOCH_MS + epochOffsetMs + generated,
        random: (length) => random.bytes(length),
      });
      generated += 1;
      return id;
    },
    count: () => generated,
  };
}

/**
 * UUIDv7 derivado de un nombre y una fecha, sin pasar por la fábrica: la marca de tiempo es el
 * mediodía UTC de la fecha y el resto sale del SHA-256 del nombre. Sirve para filas que no tienen
 * un identificador propio en el plan del seed (las etiquetas de cada animal, ADR-012), sin mover
 * la secuencia de los demás identificadores.
 */
export function derivedId(name: string, date: string): string {
  const hash = createHash('sha256').update(name).digest();
  const ms = instantOf(date).getTime();
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Math.floor(ms / 2 ** (8 * (5 - index))) & 0xff;
  }
  bytes[6] = 0x70 | ((hash[0] ?? 0) & 0x0f);
  bytes[7] = hash[1] ?? 0;
  bytes[8] = 0x80 | ((hash[2] ?? 0) & 0x3f);
  for (let index = 9; index < 16; index += 1) bytes[index] = hash[index - 6] ?? 0;
  const text = Buffer.from(bytes).toString('hex');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/**
 * Instante determinista para las columnas `timestamptz` (`created_at`, `updated_at`).
 *
 * Las marcas de tiempo se escriben explícitas en lugar de dejar el `now()` de la base de
 * datos: si cambiaran entre ejecuciones, dos seeds seguidos no darían un volcado idéntico y
 * no se podría comprobar el determinismo comparando la base entera.
 *
 * Se usa mediodía UTC (07:00 en Bogotá) del día del hecho: una hora laboral plausible que
 * además no cambia de día al convertirla a la zona de la finca.
 */
export function instantOf(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}
