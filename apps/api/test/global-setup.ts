// Jest no carga .env por su cuenta y este archivo corre en su propio proceso. dotenv no
// sobrescribe lo que ya está definido, así que en la integración continua mandan sus variables.
import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

import { maintenanceDatabaseUrl, testDatabaseName, testDatabaseUrl } from './test-env.js';

/**
 * Prepara la base de datos de las pruebas de integración (04-arquitectura.md §9: «base
 * efímera por ejecución de pruebas, migraciones aplicadas al iniciar»).
 *
 * Crea `hato_test` si no existe y le aplica todas las migraciones, incluida la manual con los
 * índices parciales, los CHECK y `pg_trgm`. Así las pruebas corren contra el mismo esquema que
 * producción, no contra uno simulado.
 */
export default async function globalSetup(): Promise<void> {
  const databaseName = testDatabaseName();

  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) {
      // El nombre viene de la configuración, no de una petición; aun así se cita con comillas
      // dobles porque CREATE DATABASE no admite parámetros.
      await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
