/**
 * Orquestación del seed de la finca de referencia, separada del script para que la prueba de
 * integración ejecute exactamente el mismo camino que `pnpm db:seed` y no una imitación.
 */

import type { IsoDate } from '@hato/shared';

import { buildCatalog, type Catalog } from './catalog.js';
import type { SeedClient } from './client.js';
import { buildEconomics, type Economics } from './economics.js';
import { buildHerd, type Herd } from './herd.js';
import { applyWeightAlertCases, buildHistory, type History } from './history.js';
import { buildFinanceCases } from './finance-cases.js';
import { createIdFactory } from './ids.js';
import { hashSeedPassword } from './password.js';
import { createRandom, REFERENCE_FARM_SEED } from './random.js';
import { buildNuevaSeed, writeNuevaSeed, type NuevaSeed } from './nueva.js';
import { buildRetiroSeed, writeRetiroSeed, type RetiroSeed } from './retiro.js';
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
  const generated = buildHistory(herd.animals, random, ids, today);
  const base = buildEconomics(herd.animals, generated.weights, random, ids, today);
  // Después de la economía, para que los casos de peso de M6 no muevan nada más (PES-05).
  const history = applyWeightAlertCases(generated, herd.animals);
  // M7: casos de finanzas con su propio generador, al final, sin mover nada de lo anterior.
  const finance = buildFinanceCases(herd.animals, history.weights);
  const economics = {
    expenses: [...base.expenses, ...finance.expenses],
    sales: base.sales,
    valuations: [...base.valuations, ...finance.valuations],
  };
  const { problems } = verifyHerd(herd, history, economics.expenses, catalog, today);

  return { catalog, herd, history, economics, problems };
}

/**
 * Escribe la finca de referencia y las fincas de pruebas El Retiro (08 §3.5) y La Nueva
 * (08 §3.8), borrando antes lo que hubiera de ellas.
 *
 * El hash de la contraseña se calcula con el generador ya consumido por la construcción,
 * para que la sal siga siendo determinista y distinta de los identificadores.
 *
 * @throws {Error} si la verificación encuentra problemas; en ese caso no escribe nada.
 */
export async function runReferenceSeed(
  prisma: SeedClient,
  options: { readonly password: string; readonly today: IsoDate },
): Promise<{
  readonly seed: ReferenceSeed;
  readonly retiro: RetiroSeed;
  readonly nueva: NuevaSeed;
  readonly counts: Record<string, number>;
}> {
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

  // Después de la de referencia: `createIdFactory` reinicia el estado de `uuidv7`, y así los
  // identificadores de La Esperanza no cambian por existir El Retiro.
  const retiro = buildRetiroSeed(options.today);
  const retiroCounts = await writeRetiroSeed(prisma, retiro, options.password, options.today);

  const nueva = buildNuevaSeed();
  const nuevaCounts = await writeNuevaSeed(prisma, nueva, options.password, options.today);

  return { seed, retiro, nueva, counts: { ...counts, ...retiroCounts, ...nuevaCounts } };
}
