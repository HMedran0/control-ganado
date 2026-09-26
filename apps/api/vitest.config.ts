import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest con unplugin-swc.
 *
 * SWC y no el esbuild que Vite trae por defecto: `decoratorMetadata` de `.swcrc` emite los
 * metadatos que la inyección de dependencias de NestJS lee en tiempo de ejecución. Con esbuild
 * las pruebas fallan con «Nest can't resolve dependencies» (ADR-005).
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/seed/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // Las pruebas de integración comparten una base de datos: se ejecutan en serie.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    // Mismo criterio que el tsconfig: @hato/shared se resuelve a su código fuente (ADR-003).
    conditions: ['development', 'import', 'node', 'default'],
  },
});
