# ADR-005 — `apps/api` es ESM, y el cliente de Prisma se genera en ESM

- **Fecha:** 2026-09-26
- **Estado:** Aceptada
- **Hito:** M0.3a
- **Afecta:** `apps/api` (tsconfig, `.swcrc`, `nest-cli.json`, `prisma/schema.prisma`), `packages/shared`

## Contexto

El hito pedía verificar en la documentación vigente de Prisma 7 cómo configurar el generador
`prisma-client` para que el formato de módulo fuera compatible con la API, y justificarlo.

La documentación de Prisma es explícita en dos puntos:

1. El generador **infiere** `moduleFormat` del entorno, y antes de la versión 7.10 emitía un
   módulo ES siempre que `tsconfig.json` tuviera `module: nodenext` —exactamente nuestra base
   de M0.1—, incluso en un proyecto CommonJS. La recomendación es **fijarlo a mano**.
2. Recomienda `moduleFormat = "cjs"` «porque NestJS compila a CommonJS».

El segundo punto **ya no es cierto**. NestJS 12 se publica solo como módulos ES:

```
node_modules/@nestjs/common/package.json   → "type": "module", exports: { ".": "./index.js" }
node_modules/@nestjs/core/package.json     → "type": "module"
node_modules/@nestjs/platform-fastify      → "type": "module"
node_modules/@nestjs/testing               → "type": "module"
```

No hay salida CommonJS que requerir. Se comprobó por el camino difícil: con `apps/api` en
CommonJS, las pruebas fallaban al cargar `@nestjs/common` con «Must use import to load ES
Module».

## Decisión

**`apps/api` es ESM** (`"type": "module"`), y el generador de Prisma emite ESM:

```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"
}
```

`importFileExtension = "js"` porque la resolución `nodenext` de un paquete ESM exige extensión
explícita en las importaciones relativas; sin ella, el código generado no resolvería en
tiempo de ejecución.

Decisiones que se derivan:

- **Compilador: SWC**, vía el builder del CLI de Nest (`nest-cli.json`) y `.swcrc` con
  `decoratorMetadata: true` y `module.type: "es6"`. La inyección de dependencias de NestJS lee
  en tiempo de ejecución los metadatos que emite `emitDecoratorMetadata`; un compilador basado
  en **esbuild no los emite**, y la aplicación falla con «Nest can't resolve dependencies».
- **Pruebas: Vitest con `unplugin-swc`**, por la misma razón: el transformador por defecto de
  Vite es esbuild. Es una desviación de `04-arquitectura.md` §10, que nombra Jest: Jest es
  CommonJS y no carga los paquetes ESM de NestJS sin configuración experimental. Como efecto
  colateral, el monorepo queda con un solo ejecutor de pruebas.
- **`packages/shared` sigue siendo solo ESM.** Se llegó a construir una segunda salida
  CommonJS para que una API en CJS pudiera requerirlo; al descubrir que NestJS 12 es ESM dejó
  de tener sentido y se eliminó.
- **En desarrollo la API consume `@hato/shared` desde `dist/`**, no desde el código fuente:
  `nest start --watch` compila únicamente `apps/api/src`, así que un `.ts` de otro paquete no
  se transformaría. `pnpm dev` deja a shared compilando en modo vigilancia (tarea `dev` de
  turbo) y la API recargando. La condición `development` del ADR-003 sigue sirviendo para el
  typecheck y el lint, que no necesitan compilar.
- **Validación con zod: pipe propia**, no `nestjs-zod`. Su versión 5.5.0 declara peers de
  NestJS 10 y 11 —no soporta NestJS 12— y además exige `@nestjs/swagger`. `ADR-05` de
  `04-arquitectura.md` mencionaba esa librería; la decisión de fondo (un mismo esquema zod
  valida el formulario y la petición) se mantiene con 25 líneas propias.

## Consecuencias

- El punto de entrada no puede usar `require.main === module`. La comprobación equivalente en
  ESM (`import.meta.url` contra `process.argv[1]`) tampoco sirve, porque `nest start` invoca
  `node dist/main` **sin extensión** y nunca coincide: se descubrió cuando `pnpm dev` compilaba
  sin arrancar el servidor. `main.ts` llama a `bootstrap()` sin condición; las pruebas no lo
  importan, porque levantan la aplicación con `createTestApp`.
- `nest-cli.json` debe ser JSON estricto, sin comentarios, a diferencia de los `tsconfig`.
- El cliente generado de Prisma trae `// @ts-nocheck` y `/* eslint-disable */`, así que no
  contamina el typecheck estricto ni el lint. Aun así se excluye de ambos: es código generado,
  no se versiona (`.gitignore`) y se regenera con `pnpm db:generate`, tarea de la que dependen
  `build`, `typecheck` y `test` en `turbo.json`.
- `fastify` es dependencia directa de `apps/api`, no solo transitiva de
  `@nestjs/platform-fastify`: el código importa sus tipos (`FastifyRequest`, `FastifyReply`) y
  con el `node_modules` estricto de pnpm eso exige declararla.
- Prisma 7 quitó `--skip-seed` de `migrate reset`: el comando siempre ejecuta lo que declara
  `migrations.seed` en `prisma.config.ts`. Por eso existe `prisma/seed/seed.ts` desde ya, como
  marcador que M0.3b reemplaza por el seed real.
- Si en el futuro se empaqueta la API con un bundler, habrá que revisar que respete ESM y las
  condiciones de `exports`.

## Alternativas descartadas

| Alternativa                                                     | Por qué no                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api` en CommonJS con `moduleFormat = "cjs"`               | Lo que recomienda la documentación de Prisma, pero es imposible: NestJS 12 no publica salida CommonJS. Se intentó y falló al cargar `@nestjs/common`. |
| Mantener CommonJS y cargar NestJS con `require(esm)` de Node 24 | Node 24 lo permite, pero el ecosistema de pruebas (Jest) no, y sería nadar contra la corriente del framework.                                         |
| Jest con ESM (`--experimental-vm-modules`)                      | Configuración experimental y frágil para un beneficio nulo frente a Vitest, que ya está en el repositorio.                                            |
| Dejar que Prisma infiera `moduleFormat`                         | Es justo lo que la documentación desaconseja: con `module: nodenext` la inferencia ha cambiado entre versiones.                                       |
