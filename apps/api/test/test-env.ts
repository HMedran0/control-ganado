/**
 * Entorno de las pruebas.
 *
 * La URL de la base de datos sale de `TEST_DATABASE_URL` o se deriva de `DATABASE_URL`
 * cambiando el nombre de la base por `hato_test`. Nunca hay puerto ni host fijos en el
 * código: en la máquina de desarrollo PostgreSQL puede estar en 5433 y en la integración
 * continua en 5432.
 */

/** URL de la base de datos de prueba. */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit !== undefined && explicit !== '') return explicit;

  const base = process.env.DATABASE_URL;
  if (base === undefined || base === '') {
    throw new Error(
      'Define TEST_DATABASE_URL o DATABASE_URL para ejecutar las pruebas de integración (ver .env.example).',
    );
  }

  const url = new URL(base);
  url.pathname = '/hato_test';
  return url.toString();
}

/** URL de la base de mantenimiento (`postgres`), para poder crear la de prueba. */
export function maintenanceDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

/** Nombre de la base de datos de prueba. */
export function testDatabaseName(): string {
  return new URL(testDatabaseUrl()).pathname.replace(/^\//, '');
}

/**
 * Variables de entorno mínimas para que `parseEnv` acepte la configuración.
 * Los secretos son de prueba y no sirven en ningún entorno real.
 */
export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.JWT_ACCESS_SECRET ??= 'secreto-de-prueba-solo-para-los-tests-1234567890';
  process.env.REFRESH_TOKEN_PEPPER ??= 'pepper-de-prueba-solo-para-los-tests-1234567890';
  process.env.CORS_ORIGINS ??= 'http://localhost:5173';
  process.env.PUBLIC_WEB_URL ??= 'http://localhost:5173';
  process.env.DEV_FAKE_AUTH = 'true';
  process.env.LOG_LEVEL = 'silent';
  delete process.env.SEED_TODAY;
}
