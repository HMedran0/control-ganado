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

import { buildCatalog } from './catalog.js';
import { createSeedClient } from './client.js';
import { buildEconomics } from './economics.js';
import { assertSeedAllowed, resolveSeedToday, SeedRefusedError } from './guards.js';
import { buildHerd } from './herd.js';
import { buildHistory } from './history.js';
import { createIdFactory } from './ids.js';
import { hashSeedPassword, readSeedPassword } from './password.js';
import { createRandom, REFERENCE_FARM_SEED } from './random.js';
import { verifyHerd } from './verify.js';
import { resetFarmData, writeSeed } from './write.js';

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const databaseUrl = assertSeedAllowed(process.env);
  const today = resolveSeedToday(process.env);
  const password = readSeedPassword(process.env);

  const started = performance.now();
  const random = createRandom(REFERENCE_FARM_SEED);
  const ids = createIdFactory(random);

  const catalog = buildCatalog(ids);
  const herd = buildHerd(catalog, random, ids, today);
  const history = buildHistory(herd.animals, random, ids, today);
  const economics = buildEconomics(herd.animals, history.weights, random, ids, today);

  // Se comprueba antes de escribir: más vale no sembrar que sembrar un hato que contradice
  // la especificación.
  const { problems } = verifyHerd(herd, history, economics.expenses, catalog, today);
  if (problems.length > 0) {
    write(`El hato generado no cumple las cifras esperadas (${problems.length} problemas):`);
    for (const problem of problems) write(`  - ${problem}`);
    throw new Error('El seed se detuvo sin escribir nada.');
  }

  const passwordHash = await hashSeedPassword(password, random);
  const prisma = createSeedClient(databaseUrl);

  try {
    await resetFarmData(prisma, catalog.farmId);
    const counts = await writeSeed(prisma, {
      catalog,
      herd,
      history,
      economics,
      passwordHash,
      today,
    });

    const elapsed = Math.round(performance.now() - started);
    write(`Finca La Esperanza sembrada en ${elapsed} ms, con «hoy» fijado en ${today}.`);
    for (const [what, count] of Object.entries(counts)) {
      write(`  ${String(count).padStart(6)} ${what}`);
    }
    write(`  Usuarios: ${catalog.users.map(({ user }) => user.username).join(', ')}.`);
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
    write(String(error instanceof Error ? error.stack ?? error.message : error));
  }
  process.exitCode = 1;
}
