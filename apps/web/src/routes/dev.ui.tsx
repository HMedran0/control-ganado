import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';

/**
 * Muestra de componentes del sistema de diseño (07 M2: «solo en desarrollo»).
 *
 * En `vite build`, `import.meta.env.DEV` vale `false`: la rama del `import()` es código muerto,
 * el empaquetador la elimina y la muestra no existe en el paquete de producción. Allí la ruta
 * responde «No encontramos esta página». Lo comprueban `scripts/check-dev-ui-excluded.mjs` y
 * la prueba de extremo a extremo contra `vite preview`.
 */
export const Route = createFileRoute('/dev/ui')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: import.meta.env.DEV
    ? lazyRouteComponent(() => import('../dev/UiShowcase'), 'UiShowcase')
    : () => null,
});
