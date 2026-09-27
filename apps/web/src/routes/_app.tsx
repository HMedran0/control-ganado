import { createFileRoute } from '@tanstack/react-router';

import { AppShell } from '../components/layout/AppShell';
import { requireSession } from '../lib/auth/guards';

/** Rutas con sesión: todo lo que cuelga de `_app/` pasa por esta guarda y este layout. */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    requireSession(context.auth.store.get(), location.href);
  },
  component: AppShell,
});
