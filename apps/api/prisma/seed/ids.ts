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
