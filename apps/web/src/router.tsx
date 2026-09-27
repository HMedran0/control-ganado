import { createRouter } from '@tanstack/react-router';

import type { RouterContext } from './lib/router-context';
import { routeTree } from './routeTree.gen';

/** Router de la aplicación, con rutas basadas en archivos (`src/routes`). */
export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  // Ampliar la interfaz de la biblioteca exige `interface`: un `type` no se fusiona.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Register {
    router: AppRouter;
  }
}
