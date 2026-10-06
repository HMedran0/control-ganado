import { createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../components/layout/AppShell';
import { dashboardQuery } from '../features/dashboard/api';
import { requireSession } from '../lib/auth/guards';

/** Rutas con sesión: todo lo que cuelga de `_app/` pasa por esta guarda y este layout. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    requireSession(context.auth.store.get(), location.href);
    // Inicio (M8a): la consulta del tablero sale ya, sin esperar a que bajen el layout, la ruta y
    // sus componentes, que se cargan aparte. En 3G cada paso de esa cascada cuesta medio segundo.
    if (location.pathname === '/') {
      void context.queryClient.prefetchQuery(dashboardQuery(context.auth.api));
    }
  },
  component: AppShell,
});
