/**
 * Deja la Finca La Nueva (08 §3.8) como la siembra el seed: vacía, con su catálogo y su ADMIN.
 *
 * Lo llama la e2e antes de importar la plantilla, para poder repetirla sin volver a sembrar toda
 * la base (`apps/web/e2e/helpers.ts`, `resetNuevaFarm`). Solo corre contra la base de pruebas
 * (`_test`), además de las guardas de siempre del seed. No toca las otras dos fincas.
 */

import { createSeedClient } from './client.js';
import {
  assertSeedAllowed,
  assertTestDatabase,
  resolveSeedToday,
  SeedRefusedError,
} from './guards.js';
import { buildNuevaSeed, writeNuevaSeed } from './nueva.js';
import { readSeedPassword } from './password.js';

async function main(): Promise<void> {
  const databaseUrl = assertSeedAllowed(process.env);
  assertTestDatabase(databaseUrl);
  const today = resolveSeedToday(process.env);
  const password = readSeedPassword(process.env);
  const prisma = createSeedClient(databaseUrl);
  try {
    await writeNuevaSeed(prisma, buildNuevaSeed(), password, today);
    process.stdout.write('Finca La Nueva vaciada y sembrada de nuevo.\n');
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  process.stdout.write(
    error instanceof SeedRefusedError
      ? `Cancelado: ${error.message}\n`
      : `${String(error instanceof Error ? (error.stack ?? error.message) : error)}\n`,
  );
  process.exitCode = 1;
}
