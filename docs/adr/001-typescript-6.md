# ADR-001 — Fijar TypeScript 6.0.x en lugar de 7.0.x

- **Fecha:** 2026-09-26
- **Estado:** Aceptada
- **Hito:** M0.1
- **Afecta:** todo el monorepo (`packages/config/tsconfig/*`, `packages/config/eslint/*`)

## Contexto

`04-arquitectura.md` §2 establece usar la última versión estable de cada herramienta y fijarla
en `package.json`. Al montar el monorepo, la última estable de TypeScript es **7.0.2** (el
compilador reescrito en Go), pero la última estable de `typescript-eslint` (8.70.1, y también
su canal `canary`) declara:

```
peerDependencies.typescript: ">=4.8.4 <6.1.0"
```

Es decir, con TypeScript 7 no hay linting con información de tipos. Ese linting no es un
extra: la definición de terminado de `07-plan-desarrollo.md` §2 exige "sin `any`
injustificado", y las reglas que lo detectan (`no-unsafe-assignment`,
`no-unsafe-argument`, `no-floating-promises`, `no-misused-promises`) solo funcionan con el
servicio de tipos. En una base de datos con dinero en `Decimal`, fechas de negocio y
transacciones Prisma, `no-floating-promises` es de las reglas que más valen.

La última estable de TypeScript compatible con `typescript-eslint` es **6.0.3**.

## Decisión

Fijar `typescript@6.0.3` en todos los paquetes. Se documenta como desviación consciente de
la regla "última estable" de `04-arquitectura.md` §2.

Se revisará cuando `typescript-eslint` publique una versión estable que acepte
`typescript@>=7`. La subida es un cambio de una línea por paquete más una ejecución de
`pnpm lint`; si aparecen cambios de comportamiento se registrarán en un ADR nuevo.

## Consecuencias

### Opciones del tsconfig base

Quedan activas: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax`, `isolatedModules`.

Se descartaron dos opciones en la base:

- **`exactOptionalPropertyTypes`**: genera fricción con los tipos generados por Prisma, con
  la salida de zod y con `react-hook-form` (que distinguen mal entre `prop?: T` y
  `prop?: T | undefined`), sin aportar seguridad real en este dominio.
- **`erasableSyntaxOnly`**: prohíbe las _parameter properties_
  (`constructor(private readonly prisma: PrismaService) {}`), que son la forma normal de
  inyección de dependencias en NestJS (M0.2–M0.3). Se activa solo donde sí aplica:
  `packages/shared` (código puro, compilado con `tsc`) y `apps/web` (transpilación por
  archivo con Vite).

### Importaciones en apps/api: valor, no `import type`

`verbatimModuleSyntax` está activo en todo el monorepo: TypeScript emite las importaciones
tal como se escriben. Consecuencia para NestJS:

> Una clase que se inyecta por constructor **debe importarse como valor**
> (`import { PrismaService } from '../infra/prisma.service.js'`), nunca con `import type`.

NestJS resuelve las dependencias en tiempo de ejecución leyendo los metadatos que emite
`emitDecoratorMetadata`; un `import type` se borra al compilar y la inyección falla con
`Nest can't resolve dependencies of ...`.

Por eso **no** se activan las reglas `@typescript-eslint/consistent-type-imports` ni
`@typescript-eslint/no-import-type-side-effects`: su autofix convertiría esas importaciones
en `import type` y rompería la aplicación en tiempo de ejecución sin que fallara ni el
typecheck ni el lint. La nota está repetida como comentario en
`packages/config/eslint/index.js` para que aparezca donde se editaría la regla.

## Alternativas descartadas

| Alternativa                                                | Por qué no                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript 7.0.2 + `typescript-eslint` con el peer forzado | El paquete no está probado contra la API del compilador nativo; el riesgo es fallo silencioso del linting con tipos, justo lo que se quería conservar. |
| TypeScript 7.0.2 y lint sin información de tipos           | Se pierden `no-floating-promises`, `no-misused-promises` y las reglas `no-unsafe-*`, que sostienen la definición de terminado del plan.                |
| TypeScript 5.9.3                                           | Innecesariamente conservador: 6.0.3 es estable y está dentro del rango soportado.                                                                      |
