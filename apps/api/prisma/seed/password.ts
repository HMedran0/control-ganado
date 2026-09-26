/**
 * Contraseña de los usuarios de demostración.
 *
 * La contraseña **no está en el código**: sale de la variable `SEED_PASSWORD` (documentada en
 * .env.example). Sin ella el seed no arranca, para que nadie termine con una finca de demo
 * protegida por una clave que está escrita en el repositorio.
 *
 * El algoritmo es Argon2id, el que exige RNF-06 y 04-arquitectura.md §5, con los parámetros
 * por defecto de `@node-rs/argon2` (m=19456, t=2, p=1), que son los recomendados por OWASP.
 */

import { hash as argon2Hash, type Algorithm, type Version } from '@node-rs/argon2';

import { SeedRefusedError } from './guards.js';
import type { SeededRandom } from './random.js';

/**
 * `@node-rs/argon2` declara `Algorithm` y `Version` como `const enum` ambientales, y
 * `verbatimModuleSyntax` no deja acceder a sus miembros (TS2748): el valor desaparecería al
 * borrar los tipos. Se usan los valores numéricos del propio paquete, con el tipo puesto a
 * mano para no perder la comprobación en la llamada.
 */
const ARGON2ID = 2 as Algorithm;
const ARGON2_V19 = 1 as Version;

/**
 * ⚠️ SAL FIJA, EXCLUSIVA DEL SEED. No copiar a `apps/api/src`.
 *
 * El seed tiene que ser determinista hasta en el hash: dos ejecuciones seguidas deben dejar
 * la base de datos idéntica, y Argon2id con sal aleatoria daría un hash distinto cada vez.
 * Por eso la sal sale del generador con semilla.
 *
 * **En M1 (autenticación) la sal debe ser aleatoria por usuario**, generada con
 * `crypto.randomBytes`, que es lo que hace `@node-rs/argon2` cuando no se le pasa `salt`.
 * Esta función no se exporta fuera del seed precisamente para que no acabe en el servicio de
 * autenticación por descuido. Los usuarios de demostración son ficticios y su contraseña es
 * de desarrollo; una sal predecible ahí no protege ni compromete nada real.
 */
function seedSalt(random: SeededRandom): Buffer {
  return Buffer.from(random.bytes(16));
}

/**
 * Lee `SEED_PASSWORD`.
 * @throws {SeedRefusedError} si falta o es demasiado corta (política mínima: 8 caracteres).
 */
export function readSeedPassword(env: NodeJS.ProcessEnv): string {
  const password = env.SEED_PASSWORD;
  if (password === undefined || password === '') {
    throw new SeedRefusedError(
      'Define SEED_PASSWORD para sembrar los usuarios de demostración (ver .env.example). ' +
        'La contraseña nunca se escribe en el código.',
    );
  }
  if (password.length < 8) {
    throw new SeedRefusedError(
      'SEED_PASSWORD debe tener al menos 8 caracteres (política mínima de 04-arquitectura.md §5).',
    );
  }
  return password;
}

/** Hash Argon2id determinista de la contraseña de demostración. */
export async function hashSeedPassword(
  password: string,
  random: SeededRandom,
): Promise<string> {
  return argon2Hash(password, {
    algorithm: ARGON2ID,
    version: ARGON2_V19,
    salt: seedSalt(random),
  });
}
