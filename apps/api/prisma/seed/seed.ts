/**
 * Seed de la finca de referencia (08 §3, 03-modelo-datos.md §6).
 *
 * Reproduce la finca La Esperanza completa: parámetros, ciclos oficiales de vacunación,
 * cuatro usuarios, catálogos y 284 animales activos con su historial 2024–2026, más 13
 * animales que ya salieron del hato.
 *
 * Es **determinista**: mismo generador con semilla, mismo «hoy» (`SEED_TODAY=2026-09-25`),
 * mismos identificadores y mismas marcas de tiempo. Dos ejecuciones seguidas dejan la base
 * de datos idéntica, lo que permite a las pruebas afirmar cifras exactas del tablero.
 *
 * Se ejecuta con `pnpm db:seed`, o solo con `pnpm db:reset`, que recrea el esquema y lo
 * llama. Necesita `SEED_PASSWORD` y una base de datos local (ver `guards.ts`).
 */

import 'dotenv/config';

import { createSeedClient } from './client.js';
import { assertSeedAllowed, resolveSeedToday, SeedRefusedError } from './guards.js';
import { readSeedPassword } from './password.js';
import { runReferenceSeed } from './run.js';

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const databaseUrl = assertSeedAllowed(process.env);
  const today = resolveSeedToday(process.env);
  const password = readSeedPassword(process.env);

  const started = performance.now();
  const prisma = createSeedClient(databaseUrl);

  try {
    const { seed, counts } = await runReferenceSeed(prisma, { password, today });
    const elapsed = Math.round(performance.now() - started);

    write(`Finca La Esperanza sembrada en ${elapsed} ms, con «hoy» fijado en ${today}.`);
    for (const [what, count] of Object.entries(counts)) {
      write(`  ${String(count).padStart(6)} ${what}`);
    }
    write(`  Usuarios: ${seed.catalog.users.map(({ user }) => user.username).join(', ')}.`);
    write('  Finca El Retiro (numeración reutilizable, 08 §3.5): usuario retiro.admin.');
    write('  Finca La Nueva (vacía, para importar la plantilla, 08 §3.7): usuario nueva.admin.');
    write('  Contraseña: la de SEED_PASSWORD.');
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SeedRefusedError) {
    write(`Seed cancelado: ${error.message}`);
  } else {
    write(String(error instanceof Error ? (error.stack ?? error.message) : error));
  }
  process.exitCode = 1;
}
