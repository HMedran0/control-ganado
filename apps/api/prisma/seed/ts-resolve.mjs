/**
 * Gancho de resolución que traduce `./x.js` a `./x.ts` cuando el `.js` no existe.
 *
 * Node 24 ejecuta TypeScript borrando los tipos, pero **no** reescribe las extensiones de las
 * importaciones relativas. El cliente que genera Prisma son archivos `.ts` que se importan
 * entre sí con extensión `.js` (`importFileExtension = "js"`, necesario para que el build con
 * SWC de la API produzca ESM válido, ADR-005), así que sin este gancho `node prisma/seed/seed.ts`
 * falla con ERR_MODULE_NOT_FOUND en `src/generated/prisma/enums.js`.
 *
 * Se aplica solo al proceso del seed (`node --import ./prisma/seed/ts-resolve.mjs`), nunca a la
 * API en producción, que corre JavaScript compilado. Ver docs/adr/006-gancho-resolucion-ts.md.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RELATIVE = /^\.{1,2}\//;

function existsAt(url) {
  try {
    return existsSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (parent === undefined || !RELATIVE.test(specifier) || !specifier.endsWith('.js')) {
      return nextResolve(specifier, context);
    }

    // Solo se reescribe si el `.js` no está y el `.ts` sí: un `.js` real siempre gana.
    if (existsAt(new URL(specifier, parent))) return nextResolve(specifier, context);

    const asTypeScript = `${specifier.slice(0, -'.js'.length)}.ts`;
    if (!existsAt(new URL(asTypeScript, parent))) return nextResolve(specifier, context);

    return nextResolve(asTypeScript, context);
  },
});
