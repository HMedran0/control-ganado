/**
 * Configuración ESLint compartida (flat config, ESLint 10).
 *
 * Uso desde la raíz del monorepo:
 *   import { hato } from '@hato/config/eslint';
 *   export default hato({ tsconfigRootDir: import.meta.dirname });
 *
 * Nota para apps/api (NestJS, desde M0.3): con `verbatimModuleSyntax` activo, una clase
 * que se inyecta por constructor debe importarse **como valor** (`import { PrismaService }`),
 * nunca con `import type`. NestJS lee esos tipos en tiempo de ejecución mediante los
 * metadatos de `emitDecoratorMetadata`; un `import type` se borra al compilar y la
 * inyección falla con "Nest can't resolve dependencies". Por eso aquí NO se activan
 * `@typescript-eslint/consistent-type-imports` ni `no-import-type-side-effects`:
 * convertirían esas importaciones automáticamente y romperían la inyección.
 * Ver docs/adr/001-typescript-6.md.
 */

import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Rutas que nunca se revisan. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/*.tsbuildinfo',
  // Especificación de partida, no código del proyecto (incluye referencia/prisma.config.ts).
  'docs/**',
];

/**
 * @param {{ tsconfigRootDir: string }} options Raíz desde la que se resuelven los tsconfig.
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function hato({ tsconfigRootDir }) {
  return tseslint.config(
    { ignores },

    // Archivos de configuración en JavaScript: sin información de tipos.
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: globals.node,
      },
    },

    // Código TypeScript: reglas con información de tipos.
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        // El SRS exige logs estructurados (pino en la API); nada de console.log.
        'no-console': 'error',
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-restricted-syntax': [
          'error',
          {
            selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
            message:
              'Prohibido new Date() en lógica de negocio: la fecha de "hoy" viene del servicio Clock (America/Bogota).',
          },
        ],
        '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },

    // Pruebas: el uso de `any` y de aserciones no nulas es aceptable al montar datos.
    {
      files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },

    // Prettier va último: apaga las reglas que chocan con el formateo.
    prettier,
  );
}

export default hato;
