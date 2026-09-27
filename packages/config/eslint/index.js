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
import reactHooks from 'eslint-plugin-react-hooks';
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
  // Cliente de Prisma: código generado, se regenera con `pnpm db:generate`.
  '**/src/generated/**',
  // Árbol de rutas de TanStack Router: lo genera el plugin de Vite.
  '**/routeTree.gen.ts',
  // Reportes y capturas de Playwright.
  '**/playwright-report/**',
  '**/test-results/**',
  '**/e2e/capturas/**',
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

    // Web (React): reglas de hooks y globales del navegador. Solo el código de `src/`: la
    // configuración de Vite y las pruebas de extremo a extremo corren en Node.
    {
      files: ['apps/web/src/**/*.{ts,tsx}'],
      extends: [reactHooks.configs.flat.recommended],
      languageOptions: { globals: globals.browser },
      rules: {
        // TanStack Router corta una navegación lanzando `redirect()`, que no es un Error por
        // diseño. Se permite ese tipo y solo ese; cualquier otro `throw` sigue exigiendo Error.
        '@typescript-eslint/only-throw-error': [
          'error',
          { allow: [{ from: 'package', package: '@tanstack/router-core', name: 'Redirect' }] },
        ],
      },
    },

    // Pruebas: el uso de `any` y de aserciones no nulas es aceptable al montar datos.
    // Las reglas `no-unsafe-*` también se apagan porque el cuerpo de una respuesta HTTP llega
    // como `any` por diseño (supertest): afirmar sobre él es justamente lo que prueba el
    // contrato de la API. En el código de producción siguen activas.
    {
      files: ['**/*.{test,spec}.{ts,tsx}', '**/*.e2e-spec.ts', '**/test/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },

    // Prettier va último: apaga las reglas que chocan con el formateo.
    prettier,
  );
}

export default hato;
