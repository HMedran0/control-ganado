import './styles/app.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { UndoToastProvider } from './components/ui/UndoToast';
import { SessionGate } from './features/auth/SessionGate';
import { ApiClient } from './lib/api/client';
import { AuthProvider } from './lib/auth/context';
import { safeRedirect } from './lib/auth/guards';
import { SessionStore } from './lib/auth/session-store';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';

const store = new SessionStore();
const queryClient = createQueryClient();

const api = new ApiClient({
  session: store,
  // El router se crea justo después; este aviso solo llega con la respuesta de una petición,
  // cuando el router ya existe.
  onSessionEnd: () => {
    queryClient.clear();
    void router.navigate({
      to: '/login',
      search: { redirect: safeRedirect(router.state.location.href), expired: true },
      replace: true,
    });
  },
});

const auth = { api, store };
const router = createAppRouter({ auth, queryClient });

// Un 403 AUTH_PASSWORD_CHANGE_REQUIRED en plena sesión (el administrador le asignó una
// contraseña temporal) lleva a la pantalla de cambio.
store.subscribe(() => {
  if (store.get()?.user.mustChangePassword === true) {
    void router.navigate({ to: '/change-password', replace: true });
  }
});

/** Referencia estable: `SessionGate` restaura una vez por intento, no en cada render. */
const restore = () => api.restore();

const container = document.getElementById('root');
if (container === null) throw new Error('Falta el elemento #root en index.html.');

createRoot(container).render(
  <StrictMode>
    <AuthProvider auth={auth}>
      <QueryClientProvider client={queryClient}>
        <SessionGate restore={restore}>
          <UndoToastProvider>
            <RouterProvider router={router} />
          </UndoToastProvider>
        </SessionGate>
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
);
