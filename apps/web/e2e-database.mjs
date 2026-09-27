/**
 * Base de datos de las pruebas de extremo a extremo.
 *
 * Es siempre la de `TEST_DATABASE_URL` (`hato_test`), la misma que usa la integración
 * continua, y nunca la de desarrollo: las pruebas crean usuarios, catálogos y animales. Como
 * defensa adicional, el nombre de la base debe terminar en `_test`.
 *
 * La usan `playwright.config.ts` (para la API que levanta) y `scripts/e2e-seed.mjs` (para
 * sembrarla), así que las dos piezas no pueden apuntar a bases distintas.
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function e2eDatabaseUrl(env) {
  const url = env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'Define TEST_DATABASE_URL (ver .env.example): las pruebas de extremo a extremo no usan la base de desarrollo.',
    );
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL apunta a «${name}»: el nombre de la base de pruebas debe terminar en _test.`,
    );
  }
  return url;
}

/** Puerto de la API que levantan las pruebas, distinto del 3000 de `pnpm dev`. */
export const E2E_API_PORT = 3100;
