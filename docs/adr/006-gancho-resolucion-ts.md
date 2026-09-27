# ADR-006 — Gancho de resolución `.js` → `.ts` para ejecutar el seed

- **Fecha:** 2026-09-26
- **Estado:** Aceptada
- **Hito:** M0.3b
- **Afecta:** `apps/api/prisma/seed/ts-resolve.mjs`, `apps/api/prisma.config.ts`, `apps/api/package.json`

## Contexto

El seed de la finca de referencia (03-modelo-datos.md §6) necesita dos cosas en el mismo
proceso: el cliente de Prisma, para escribir, y las funciones de `@hato/shared`, porque la
categoría, las etiquetas y el estado de vacunas de cada animal tienen que salir de ahí y no
asignarse a mano (CLAUDE.md, regla 5).

Node 24 ejecuta TypeScript borrando los tipos, sin ejecutor aparte, y así arrancaba el
marcador de posición de M0.3a. Pero el borrado de tipos **no reescribe las extensiones** de las
importaciones relativas: `import './enums.js'` busca exactamente `enums.js`. El generador
`prisma-client` emite el cliente como archivos `.ts` que se importan entre sí con extensión
`.js`, porque `importFileExtension = "js"` es lo que hace que el build de la API con SWC
produzca ESM válido (ADR-005). Resultado, comprobado:

```
$ node prisma/seed/seed.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  .../src/generated/prisma/enums.js imported from .../src/generated/prisma/client.ts
```

El seed, entonces, no podía ejecutarse con `node` a secas.

## Decisión

Un gancho de resolución de 30 líneas, `apps/api/prisma/seed/ts-resolve.mjs`, registrado con
`module.registerHooks` (API síncrona de Node, estable desde 22.15) y cargado solo por los
comandos del seed:

```
node --conditions=development --import ./prisma/seed/ts-resolve.mjs prisma/seed/seed.ts
```

El gancho reescribe un especificador **relativo** que termina en `.js` a `.ts` **solo** si el
`.js` no existe y el `.ts` sí. Un archivo JavaScript real siempre gana, así que el gancho no
puede desviar una importación legítima.

`--conditions=development` es aparte y responde a ADR-003: resuelve `@hato/shared` a su código
fuente, para que el seed no exija compilar `shared` antes.

Alcance: **solo el proceso del seed**. La API en producción ejecuta JavaScript compilado
(`node dist/main.js`) y no carga nada de esto. Las pruebas tampoco lo necesitan: Vite ya
resuelve `.js` → `.ts`.

## Consecuencias

- `pnpm db:seed`, `pnpm db:seed:load` y `prisma migrate reset` funcionan sin compilar nada y
  sin ejecutor de TypeScript.
- Ninguna dependencia nueva para esto.
- La integración continua ejecuta `pnpm db:seed` como un paso propio, para que el camino del
  comando (gancho incluido) no se rompa sin que nadie se entere: las pruebas importan el seed
  como módulo y no pasarían por el gancho.
- Si Prisma llegara a generar el cliente en JavaScript, o Node aprendiera a reescribir
  extensiones, el gancho deja de hacer falta.

## Cómo retirarlo

1. Comprobar que `node prisma/seed/seed.ts` arranca sin `--import`.
2. Quitar `--import ./prisma/seed/ts-resolve.mjs` de `prisma.config.ts` (`migrations.seed`) y
   de los scripts `db:seed:load` de `apps/api/package.json`.
3. Borrar `apps/api/prisma/seed/ts-resolve.mjs` y marcar este ADR como «Reemplazada».

`--conditions=development` se retira por separado, y solo si se revierte ADR-003.

## Alternativas descartadas

| Alternativa                                      | Por qué no                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsx` o `ts-node` como dependencia de desarrollo | Una dependencia con su propio árbol para resolver un detalle de extensiones que se arregla con 30 líneas de una API estable de Node.            |
| `importFileExtension = "ts"` en el generador     | Rompería el build de la API: SWC no reescribe extensiones y `dist/` quedaría importando `.ts`.                                                  |
| Compilar el seed antes de ejecutarlo             | `pnpm db:seed` pasaría a depender del build; `prisma migrate reset` ejecuta el seed por su cuenta y no puede compilar primero.                  |
| Escribir el seed con SQL y `pg`, sin el cliente  | Duplica los nombres de columnas ya declarados en el esquema y deja el seed sin tipos, justo donde más ayudan (297 animales con sus relaciones). |
| Un `--loader` asíncrono                          | `module.registerHooks` es síncrono, no abre un hilo aparte y es la API recomendada desde Node 22.15.                                            |
