# ADR-003 — `@hato/shared` expone su código fuente con la condición `development`

- **Fecha:** 2026-09-26
- **Estado:** Aceptada
- **Hito:** M0.2
- **Afecta:** `packages/shared/package.json`, `apps/api/tsconfig.json`, `apps/web/tsconfig.json`, scripts de la raíz

## Contexto

En M0.1, `@hato/shared` solo publicaba `dist/`. Como `apps/api` y `apps/web` importan el
paquete, su `tsconfig` resolvía los tipos desde `dist/index.d.ts`, así que había que compilar
shared antes de poder revisar tipos o ejecutar el lint con información de tipos. De ahí que
`pnpm lint` fuera `turbo run build && eslint .`.

Eso tiene dos costos. El primero es de flujo: al cambiar una función de dominio, el editor y
el lint siguen viendo los tipos anteriores hasta que se recompila, y los errores aparecen en
un `.d.ts` en lugar de en la línea que los causa. El segundo es de confianza: un `dist/`
rancio puede hacer pasar un `typecheck` que en realidad estaba roto.

## Decisión

`@hato/shared` declara la condición `development` antes de los tipos y del default:

```json
"exports": {
  ".": {
    "development": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

`apps/api` y `apps/web` activan esa condición en su `tsconfig.json` con
`"customConditions": ["development"]` (requiere `moduleResolution: nodenext`, que ya usamos).

Reparto de responsabilidades:

- **Tiempo de desarrollo** (tsc, ESLint con tipos, Vitest, Vite): se resuelve
  `./src/index.ts`. No hace falta compilar shared antes, `pnpm lint` vuelve a ser `eslint .`
  y `typecheck` deja de depender de `build` en `turbo.json`.
- **Tiempo de ejecución y build** (Node al arrancar la API, empaquetado de producción): Node
  no activa `development` salvo que se le pase `--conditions=development`, así que resuelve
  `dist/index.js`. `packages/shared` sigue compilándose con `tsc` y `pnpm build` no cambia.

## Consecuencias

- Los archivos de `packages/shared/src` entran al programa de TypeScript de `apps/api` y de
  `apps/web`. Consecuencia práctica: **shared no puede usar APIs de Node**, porque
  `apps/web` compila con `types: []` y `lib: dom`. Eso ya era deseable (el paquete también
  tiene que funcionar en Expo en F2), y ahora el typecheck lo hace cumplir. Para los números
  aleatorios de `id.ts` se usa `globalThis.crypto.getRandomValues`, que existe en Node 18+,
  en los navegadores y en React Native.
- Un error de tipos en shared se reporta también al revisar `apps/api` o `apps/web`. Es
  ruido aceptable: el mismo error ya falla en `pnpm typecheck` de shared.
- Cuando M0.3 ejecute la API con `tsx` o `ts-node` en desarrollo, hay que decidir si se le
  pasa `--conditions=development` (código fuente, recarga inmediata) o no (compilado). Se
  resolverá en ese hito; la elección no afecta a producción, que siempre usa `dist/`.
- Los clientes que no puedan activar condiciones personalizadas (una herramienta con
  resolución propia) siguen funcionando: caen en `default` y usan `dist/`.

## Alternativas descartadas

| Alternativa                                                     | Por qué no                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seguir compilando antes de lint y typecheck                     | Funciona, pero paga el costo en cada iteración y deja la puerta abierta a un `dist/` rancio que enmascare errores.                                                                                |
| Apuntar `exports` directamente a `./src/index.ts` sin condición | Rompe el arranque de la API con Node, que no sabe ejecutar TypeScript.                                                                                                                            |
| `paths` en el `tsconfig` de cada consumidor                     | Resuelve el typecheck pero no la resolución de Vite ni la de Vitest, así que habría dos mecanismos distintos que se pueden desincronizar. `exports` es uno solo, que todas las herramientas leen. |
| Referencias de proyecto de TypeScript (`composite`)             | Sigue trabajando contra los `.d.ts` emitidos; conserva el paso de compilación y agrega la gestión de `tsbuildinfo`.                                                                               |
