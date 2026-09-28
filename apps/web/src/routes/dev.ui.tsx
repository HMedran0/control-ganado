import { createFileRoute, notFound } from '@tanstack/react-router';
import { lazy } from 'react';

/**
 * Muestra de componentes del sistema de diseño (07 M2: «solo en desarrollo»).
 *
 * En `vite build`, `import.meta.env.DEV` vale `false`: la rama del `import()` es código muerto,
 * el empaquetador la elimina y la muestra no existe en el paquete de producción. Allí la ruta
 * responde «No encontramos esta página». Lo comprueban `scripts/check-dev-ui-excluded.mjs` y
 * la prueba de extremo a extremo contra `vite preview`.
 *
 * `React.lazy` y no `lazyRouteComponent` de TanStack Router: este último llama a `use()` solo
 * mientras el módulo no ha cargado, y React 19 avisa en desarrollo de ese `use()` condicional
 * («This library called use() to suspend in a previous render…»). La suspensión la recoge el
 * `Suspense` que el enrutador pone alrededor de cada ruta.
 */
export const Route = createFileRoute('/dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: import.meta.env.DEV
    ? lazy(() => import('../dev/UiShowcase').then((module) => ({ default: module.UiShowcase })))
    : () => null,
});
