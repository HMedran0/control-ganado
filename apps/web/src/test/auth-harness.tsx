import type { SessionResponse } from '@hato/shared';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import { ApiClient } from '../lib/api/client';
import { AuthProvider } from '../lib/auth/context';
import { SessionStore } from '../lib/auth/session-store';

/** Sesión de ejemplo con los datos de la finca de referencia. */
export function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    accessToken: 'token-de-prueba',
    user: {
      id: '0190a000-0000-7000-8000-000000000001',
      name: 'Álvaro Pérez Castro',
      username: 'alvaro',
      email: 'alvaro@demo.co',
      mustChangePassword: false,
    },
    farm: { id: '0190a000-0000-7000-8000-0000000000f1', name: 'Finca La Esperanza' },
    role: 'ADMIN',
    memberships: [],
    ...overrides,
  };
}

/** Respuesta problem+json como la de la API. */
export function problem(status: number, code: string, detail: string, extra = {}): Response {
  return new Response(JSON.stringify({ status, code, detail, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** Respuesta JSON exitosa. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Monta un componente con un `ApiClient` real sobre un `fetch` falso: la prueba ejercita la
 * misma traducción de errores que la aplicación.
 */
export function renderWithAuth(
  ui: ReactElement,
  respond: (url: string, init: RequestInit) => Promise<Response> | Response,
  session: SessionResponse | null = null,
): RenderResult & { store: SessionStore; fetchMock: ReturnType<typeof vi.fn> } {
  const store = new SessionStore();
  if (session !== null) store.set(session);
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(respond(url, init ?? {})),
  );
  const api = new ApiClient({ session: store, fetch: fetchMock as unknown as typeof fetch });
  const result = render(<AuthProvider auth={{ api, store }}>{ui}</AuthProvider>);
  return { ...result, store, fetchMock };
}
