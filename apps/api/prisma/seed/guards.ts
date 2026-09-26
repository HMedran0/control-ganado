/**
 * Guardas del seed: dónde y cuándo se puede ejecutar.
 *
 * El seed **borra y reescribe** los datos de su finca, así que antes de tocar nada comprueba
 * que no está apuntando a algo que importe: ni `NODE_ENV=production`, ni una base de datos
 * que no sea local o la del servicio de la integración continua.
 */

import { toIsoDate, type IsoDate } from '@hato/shared';

/**
 * «Hoy» de la finca de referencia (08 §3, `SEED_TODAY` en .env.example).
 *
 * No es un valor configurable: el calendario del hato (fechas de nacimiento, servicios,
 * jornadas de vacunación) está construido alrededor de esta fecha para que las cifras de
 * `expected.ts` sean exactas. Por eso `resolveSeedToday` rechaza cualquier otro valor en
 * lugar de generar en silencio un hato distinto.
 */
export const SEED_TODAY: IsoDate = toIsoDate('2026-09-25');

/**
 * Anfitriones aceptados en `DATABASE_URL`.
 *
 * `localhost` y `127.0.0.1` cubren la máquina de desarrollo y el servicio `db` de la
 * integración continua, que publica el puerto en localhost; `db` y `postgres` cubren el caso
 * de ejecutar el seed dentro de la red de Docker Compose.
 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres']);

/** Error de una guarda: el mensaje ya está listo para mostrarse en la terminal. */
export class SeedRefusedError extends Error {
  override readonly name = 'SeedRefusedError';
}

function refuse(detail: string): never {
  throw new SeedRefusedError(detail);
}

/** ¿La URL apunta a una base de datos local o a la de la integración continua? */
export function isAllowedDatabaseUrl(databaseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return false;
  }
  return ALLOWED_HOSTS.has(host.toLowerCase());
}

/** Entorno que leen las guardas. Se pasa explícito para poder probarlo. */
export type SeedEnvironment = {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly SEED_TODAY?: string | undefined;
  /** El resto del entorno; permite pasar `process.env` tal cual. */
  readonly [key: string]: string | undefined;
};

/**
 * Comprueba que el seed puede ejecutarse y devuelve la URL de la base de datos.
 * @throws {SeedRefusedError} si el entorno es de producción o la base no es local.
 */
export function assertSeedAllowed(env: SeedEnvironment): string {
  if (env.NODE_ENV === 'production') {
    refuse(
      'El seed no se ejecuta en producción (NODE_ENV=production): borra y reescribe los datos ' +
        'de la finca de referencia.',
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    refuse('Define DATABASE_URL para ejecutar el seed (ver .env.example).');
  }

  if (!isAllowedDatabaseUrl(databaseUrl)) {
    const host = URL.canParse(databaseUrl) ? new URL(databaseUrl).hostname : '(ilegible)';
    refuse(
      `El seed solo escribe en una base de datos local: «${host}» no está permitido. ` +
        `Anfitriones aceptados: ${[...ALLOWED_HOSTS].join(', ')}.`,
    );
  }

  return databaseUrl;
}

/**
 * Fecha de «hoy» del seed.
 * @throws {SeedRefusedError} si `SEED_TODAY` está definida con otro valor.
 */
export function resolveSeedToday(env: SeedEnvironment): IsoDate {
  const configured = env.SEED_TODAY;
  if (configured === undefined || configured === '') return SEED_TODAY;
  if (configured !== SEED_TODAY) {
    refuse(
      `SEED_TODAY=${configured} no coincide con la fecha de la finca de referencia (${SEED_TODAY}). ` +
        'El hato y las cifras esperadas están construidos para esa fecha; cámbiala en .env o bórrala.',
    );
  }
  return SEED_TODAY;
}
