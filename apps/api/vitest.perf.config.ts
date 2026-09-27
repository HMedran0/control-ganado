import { defineConfig } from 'vitest/config';

import base from './vitest.config.js';

/**
 * Pruebas de rendimiento (RNF-01), aparte de `pnpm test`: necesitan el seed de carga en la base
 * de pruebas y no la vacían. Ver `test/perf/animals.perf-spec.ts`.
 *
 * Se reemplaza `include` en lugar de combinar con `mergeConfig`, que concatena las listas y
 * correría también la suite normal (que vacía la base).
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/perf/**/*.perf-spec.ts'],
    testTimeout: 120_000,
  },
});
