/**
 * Orquestación del seed de la finca de referencia, separada del script para que la prueba de
 * integración ejecute exactamente el mismo camino que `pnpm db:seed` y no una imitación.
 */

import type { IsoDate } from '@hato/shared';

import { buildCatalog, type Catalog } from './catalog.js';
import type { SeedClient } from './client.js';
import { buildEconomics, type Economics } from './economics.js';
import { buildHerd, type Herd } from './herd.js';
import { buildHistory, type History } from './history.js';
import { createIdFactory } from './ids.js';
import { hashSeedPassword } from './password.js';
import { createRandom, REFERENCE_FARM_SEED } from './random.js';
import { verifyHerd } from './verify.js';
import { resetFarmData, writeSeed } from './write.js';

/** Finca de referencia completa, en memoria y ya verificada. */
export type ReferenceSeed = {
  readonly catalog: Catalog;
  readonly herd: Herd;
  readonly history: History;
  readonly economics: Economics;
  readonly problems: readonly string[];
};

/**
 * Genera la finca en memoria y la verifica. No toca la base de datos, así que sirve también
 * para probar el generador sin PostgreSQL.
 */
export function buildReferenceSeed(today: IsoDate): ReferenceSeed {
  const random = createRandom(REFERENCE_FARM_SEED);
  const ids = createIdFactory(random);

  const catalog = buildCatalog(ids);
  const herd = buildHerd(catalog, random, ids, today);
  const history = buildHistory(herd.animals, random, ids, today);
  const economics = buildEconomics(herd.animals, history.weights, random, ids, today);
  const { problems } = verifyHerd(herd, history, economics.expenses, catalog, today);

  return { catalog, herd, history, economics, problems };
}

/**
 * Escribe la finca de referencia, borrando antes lo que hubiera de ella.
 *
 * El hash de la contraseña se calcula con el generador ya consumido por la construcción,
 * para que la sal siga siendo determinista y distinta de los identificadores.
 *
 * @throws {Error} si la verificación encuentra problemas; en ese caso no escribe nada.
 */
export async function runReferenceSeed(
  prisma: SeedClient,
  options: { readonly password: string; readonly today: IsoDate },
): Promise<{ readonly seed: ReferenceSeed; readonly counts: Record<string, number> }> {
  const seed = buildReferenceSeed(options.today);
  if (seed.problems.length > 0) {
    throw new Error(
      `El hato generado no cumple las cifras esperadas:\n  - ${seed.problems.join('\n  - ')}`,
    );
  }

  const passwordHash = await hashSeedPassword(options.password, createRandom(REFERENCE_FARM_SEED));
  await resetFarmData(prisma, seed.catalog.farmId);
  const counts = await writeSeed(prisma, {
    catalog: seed.catalog,
    herd: seed.herd,
    history: seed.history,
    economics: seed.economics,
    passwordHash,
    today: options.today,
  });

  return { seed, counts };
}
