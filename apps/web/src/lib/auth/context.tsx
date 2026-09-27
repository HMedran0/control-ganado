import type { SessionResponse } from '@hato/shared';
import { createContext, use, useSyncExternalStore, type ReactNode } from 'react';

import type { ApiClient } from '../api/client';
import type { SessionStore } from './session-store';

/** Lo que la interfaz necesita para hablar con la API y conocer la sesión. */
export type Auth = {
  readonly api: ApiClient;
  readonly store: SessionStore;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ auth, children }: { auth: Auth; children: ReactNode }) {
  return <AuthContext value={auth}>{children}</AuthContext>;
}

/** Cliente de la API y almacén de la sesión. */
export function useAuth(): Auth {
  const auth = use(AuthContext);
  if (auth === null) throw new Error('useAuth necesita un AuthProvider.');
  return auth;
}

/** Sesión actual; se vuelve a pintar cuando cambia. */
export function useSession(): SessionResponse | null {
  const { store } = useAuth();
  return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * Sesión actual dentro de las rutas protegidas, donde el router ya garantizó que existe.
 * Si falta, es un error de programación, no un estado de la interfaz.
 */
export function useRequiredSession(): SessionResponse {
  const session = useSession();
  if (session === null) throw new Error('Esta vista requiere una sesión iniciada.');
  return session;
}
