/**
 * Prepara `hato_test` para las pruebas de extremo a extremo: aplica las migraciones y carga la
 * finca de referencia (`pnpm db:seed`), con `DATABASE_URL` apuntando a `TEST_DATABASE_URL`.
 *
 * Se ejecuta con `pnpm --filter @hato/web test:e2e:seed`. Hace falta repetirlo después de
 * `pnpm test`, porque las pruebas de integración de la API vacían esa misma base.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { e2eDatabaseUrl } from '../e2e-database.mjs';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl(process.env) };
// Una sola cadena y no una lista de argumentos: en Windows `pnpm` es un .cmd y solo arranca
// con `shell`, que con argumentos sueltos está obsoleto (DEP0190). El texto es fijo.
const run = (script) =>
  execSync(`pnpm --filter @hato/api run ${script}`, { env, stdio: 'inherit' });

run('db:migrate:deploy');
run('db:seed');
