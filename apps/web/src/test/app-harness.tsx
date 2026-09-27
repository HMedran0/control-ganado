import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import { UndoToastProvider } from '../components/ui/UndoToast';
import { ApiClient } from '../lib/api/client';
import { AuthProvider } from '../lib/auth/context';
import { SessionStore } from '../lib/auth/session-store';
import { fakeSession } from './auth-harness';

type Respond = (url: string, init: RequestInit) => Promise<Response> | Response;

/**
 * Monta una pantalla con todo lo que usa la aplicación: sesión de ADMIN, cliente de la API
 * sobre un `fetch` falso, React Query, avisos «Deshacer» y un router en memoria.
 */
export async function renderApp(
  ui: ReactElement,
  respond: Respond,
): Promise<RenderResult & { fetchMock: ReturnType<typeof vi.fn> }> {
  const store = new SessionStore();
  store.set(fakeSession());
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(respond(url, init ?? {})),
  );
  const api = new ApiClient({ session: store, fetch: fetchMock as unknown as typeof fetch });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <div data-testid="raiz-de-prueba">{ui}</div>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const result = render(
    <AuthProvider auth={{ api, store }}>
      <QueryClientProvider client={queryClient}>
        <UndoToastProvider>
          <RouterProvider router={router} />
        </UndoToastProvider>
      </QueryClientProvider>
    </AuthProvider>,
  );
  await screen.findByTestId('raiz-de-prueba');
  return { ...result, fetchMock };
}

/** Cuerpo JSON de la llamada `n` a `fetch`. */
export function sentBody(fetchMock: ReturnType<typeof vi.fn>, n: number): unknown {
  const init = fetchMock.mock.calls[n]?.[1] as RequestInit | undefined;
  return JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
}
