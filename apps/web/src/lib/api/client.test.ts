import type { SessionResponse } from '@hato/shared';
import { describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../auth/session-store';
import { ApiClient, REFRESH_LOCK_NAME, type LockRunner } from './client';
import { NETWORK_ERROR_DETAIL, type ApiError } from './errors';

function session(accessToken: string, overrides: Partial<SessionResponse['user']> = {}) {
  return {
    accessToken,
    user: {
      id: '0190a000-0000-7000-8000-000000000001',
      name: 'Álvaro Pérez Castro',
      username: 'alvaro',
      email: null,
      mustChangePassword: false,
      ...overrides,
    },
    farm: { id: '0190a000-0000-7000-8000-0000000000f1', name: 'Finca La Esperanza' },
    role: 'ADMIN',
    memberships: [],
  } satisfies SessionResponse;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problem(status: number, code: string, detail = 'detalle', extra = {}): Response {
  return new Response(JSON.stringify({ status, code, detail, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** Deja correr las promesas pendientes para que las peticiones se crucen de verdad. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

function setup(handler: Handler, options: { lock?: LockRunner } = {}) {
  const store = new SessionStore();
  const onSessionEnd = vi.fn();
  // El cliente siempre llama con la URL como texto.
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {})),
  );
  const api = new ApiClient({
    session: store,
    fetch: fetchMock as unknown as typeof fetch,
    onSessionEnd,
    ...(options.lock === undefined ? {} : { lock: options.lock }),
  });
  const calls = (path: string): number =>
    fetchMock.mock.calls.filter(([url]) => url.endsWith(path)).length;
  return { store, api, onSessionEnd, fetchMock, calls };
}

function authorization(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.authorization;
}

describe('ApiClient', () => {
  it('envía el token de acceso en memoria como Bearer', async () => {
    const { store, api, fetchMock } = setup(() => json({ ok: true }));
    store.set(session('token-a'));

    await api.get('/me');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('same-origin');
    expect(authorization(init!)).toBe('Bearer token-a');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/me');
  });

  describe('refresco ante AUTH_TOKEN_EXPIRED', () => {
    it('con tres 401 simultáneos refresca una sola vez y repite las tres peticiones', async () => {
      const { store, api, calls, onSessionEnd } = setup(async (url, init) => {
        if (url.endsWith('/auth/refresh')) {
          await tick();
          return json(session('nuevo'));
        }
        return authorization(init) === 'Bearer nuevo'
          ? json({ path: url })
          : problem(401, 'AUTH_TOKEN_EXPIRED');
      });
      store.set(session('viejo'));

      const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

      expect(results).toEqual([
        { path: '/api/v1/a' },
        { path: '/api/v1/b' },
        { path: '/api/v1/c' },
      ]);
      expect(calls('/auth/refresh')).toBe(1);
      expect(store.get()?.accessToken).toBe('nuevo');
      expect(onSessionEnd).not.toHaveBeenCalled();
    });

    it('si el refresco falla, cierra la sesión, avisa una vez y rechaza todas', async () => {
      const { store, api, calls, onSessionEnd } = setup(async (url) => {
        if (url.endsWith('/auth/refresh')) {
          await tick();
          return problem(401, 'AUTH_TOKEN_EXPIRED');
        }
        return problem(401, 'AUTH_TOKEN_EXPIRED');
      });
      store.set(session('viejo'));

      const results = await Promise.allSettled([api.get('/a'), api.get('/b'), api.get('/c')]);

      for (const result of results) {
        expect(result.status).toBe('rejected');
        expect(((result as PromiseRejectedResult).reason as ApiError).code).toBe(
          'AUTH_TOKEN_EXPIRED',
        );
      }
      expect(calls('/auth/refresh')).toBe(1);
      expect(store.get()).toBeNull();
      expect(onSessionEnd).toHaveBeenCalledTimes(1);
    });

    it('no entra en bucle si la API rechaza también el token recién emitido', async () => {
      const { store, api, calls, onSessionEnd } = setup((url) =>
        url.endsWith('/auth/refresh') ? json(session('nuevo')) : problem(401, 'AUTH_TOKEN_EXPIRED'),
      );
      store.set(session('viejo'));

      await expect(api.get('/a')).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
      expect(calls('/auth/refresh')).toBe(1);
      expect(calls('/a')).toBe(2);
      expect(store.get()).toBeNull();
      expect(onSessionEnd).toHaveBeenCalledTimes(1);
    });

    it('si otra petición ya refrescó, reintenta con el token actual sin refrescar', async () => {
      const { store, api, calls } = setup((_url, init) => {
        if (authorization(init) === 'Bearer viejo') {
          // Mientras esta petición viaja, otra ya obtuvo un token nuevo.
          store.set(session('nuevo'));
          return problem(401, 'AUTH_TOKEN_EXPIRED');
        }
        return json({ ok: true });
      });
      store.set(session('viejo'));

      await expect(api.get('/a')).resolves.toEqual({ ok: true });
      expect(calls('/auth/refresh')).toBe(0);
    });

    it('sin red durante el refresco no cierra la sesión', async () => {
      const { store, api, onSessionEnd } = setup((url) => {
        if (url.endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
        return problem(401, 'AUTH_TOKEN_EXPIRED');
      });
      store.set(session('viejo'));

      await expect(api.get('/a')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      expect(store.get()?.accessToken).toBe('viejo');
      expect(onSessionEnd).not.toHaveBeenCalled();
    });

    it('refresca dentro del candado entre pestañas', async () => {
      const lockSpy = vi.fn();
      const lock: LockRunner = (name, task) => {
        lockSpy(name);
        return task();
      };
      const { store, api } = setup(
        (url, init) =>
          url.endsWith('/auth/refresh')
            ? json(session('nuevo'))
            : authorization(init) === 'Bearer nuevo'
              ? json({ ok: true })
              : problem(401, 'AUTH_TOKEN_EXPIRED'),
        { lock },
      );
      store.set(session('viejo'));

      await api.get('/a');

      expect(lockSpy).toHaveBeenCalledTimes(1);
      expect(lockSpy).toHaveBeenCalledWith(REFRESH_LOCK_NAME);
    });

    it('un 401 de credenciales en el inicio de sesión no intenta refrescar', async () => {
      const { api, calls, onSessionEnd } = setup(() =>
        problem(401, 'AUTH_INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.'),
      );

      await expect(api.login({ login: 'alvaro', password: 'x' })).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
        detail: 'Usuario o contraseña incorrectos.',
      });
      expect(calls('/auth/refresh')).toBe(0);
      expect(onSessionEnd).not.toHaveBeenCalled();
    });

    it('un 401 por contraseña actual equivocada no intenta refrescar', async () => {
      const { store, api, calls } = setup(() =>
        problem(401, 'AUTH_INVALID_CREDENTIALS', 'La contraseña actual no es correcta.'),
      );
      store.set(session('vigente'));

      await expect(
        api.changePassword({ currentPassword: 'x', newPassword: 'nueva-clave-1' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
      expect(calls('/auth/refresh')).toBe(0);
      expect(store.get()).not.toBeNull();
    });
  });

  it('marca el cambio de contraseña obligatorio ante AUTH_PASSWORD_CHANGE_REQUIRED', async () => {
    const { store, api } = setup(() => problem(403, 'AUTH_PASSWORD_CHANGE_REQUIRED'));
    store.set(session('vigente'));

    await expect(api.get('/animals')).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_CHANGE_REQUIRED',
    });
    expect(store.get()?.user.mustChangePassword).toBe(true);
  });

  describe('traducción de errores', () => {
    it('problem+json → code, detail y errores por campo', async () => {
      const { api } = setup(() =>
        problem(422, 'VALIDATION_FAILED', 'Revisa los campos marcados.', {
          errors: { login: ['Escribe tu usuario o correo.'] },
        }),
      );

      await expect(api.post('/x', {}, { auth: false })).rejects.toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
        detail: 'Revisa los campos marcados.',
        fieldErrors: { login: ['Escribe tu usuario o correo.'] },
      });
    });

    it('problem+json con context → datos del caso para la interfaz', async () => {
      const { api } = setup(() =>
        problem(409, 'IDENTIFIER_TAKEN', 'El identificador 87 ya está asignado al animal 26-001.', {
          context: { animalId: '0199a1b2-0000-7000-8000-000000000001', animalCode: '26-001' },
        }),
      );

      await expect(api.post('/x', {}, { auth: false })).rejects.toMatchObject({
        code: 'IDENTIFIER_TAKEN',
        context: { animalId: '0199a1b2-0000-7000-8000-000000000001', animalCode: '26-001' },
      });
    });

    it('sin red → NETWORK_ERROR con el mensaje de conexión', async () => {
      const { api } = setup(() => {
        throw new TypeError('Failed to fetch');
      });

      await expect(api.get('/x', { auth: false })).rejects.toMatchObject({
        status: 0,
        code: 'NETWORK_ERROR',
        detail: NETWORK_ERROR_DETAIL,
      });
    });

    it('un 5xx sin problem+json (proxy con la API caída) → NETWORK_ERROR', async () => {
      const { api } = setup(() => new Response('', { status: 502 }));

      await expect(api.get('/x', { auth: false })).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });
    });

    it('un código desconocido → INTERNAL_ERROR con el mensaje del catálogo', async () => {
      const { api } = setup(() => problem(400, 'ALGO_RARO'));

      await expect(api.get('/x', { auth: false })).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        detail: 'Ocurrió un error inesperado. Ya quedó registrado.',
      });
    });
  });

  describe('tope de la sesión (AUT-10 CA2)', () => {
    it('AUTH_SESSION_MAX_AGE al abrir: no hay sesión y se recuerda el usuario', async () => {
      const { store, api } = setup(() =>
        problem(401, 'AUTH_SESSION_MAX_AGE', 'Por seguridad…', { context: { login: 'alvaro' } }),
      );
      await expect(api.restore()).resolves.toBeNull();
      expect(store.reauthLogin()).toBe('alvaro');

      store.set(session('nuevo'));
      expect(store.reauthLogin()).toBeNull();
    });

    it('en medio del trabajo: cierra la sesión, avisa una vez y recuerda el usuario', async () => {
      const { store, api, onSessionEnd } = setup((url) =>
        url.endsWith('/auth/refresh')
          ? problem(401, 'AUTH_SESSION_MAX_AGE', 'Por seguridad…', { context: { login: 'alvaro' } })
          : problem(401, 'AUTH_TOKEN_EXPIRED'),
      );
      store.set(session('viejo'));

      await expect(api.get('/a')).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
      expect(store.get()).toBeNull();
      expect(store.reauthLogin()).toBe('alvaro');
      expect(onSessionEnd).toHaveBeenCalledTimes(1);
    });

    it('otro 401 del refresco no recuerda a nadie', async () => {
      const { store, api } = setup(() => problem(401, 'AUTH_TOKEN_EXPIRED'));
      await expect(api.restore()).resolves.toBeNull();
      expect(store.reauthLogin()).toBeNull();
    });
  });

  describe('restore() al abrir la aplicación', () => {
    it('con cookie válida → guarda la sesión', async () => {
      const { store, api } = setup(() => json(session('restaurado')));

      await expect(api.restore()).resolves.toMatchObject({ accessToken: 'restaurado' });
      expect(store.get()?.accessToken).toBe('restaurado');
    });

    it('con 401 → no hay sesión, sin error', async () => {
      const { store, api, onSessionEnd } = setup(() => problem(401, 'AUTH_TOKEN_EXPIRED'));

      await expect(api.restore()).resolves.toBeNull();
      expect(store.get()).toBeNull();
      expect(onSessionEnd).not.toHaveBeenCalled();
    });

    it('sin red → NETWORK_ERROR (no se decide que no hay sesión)', async () => {
      const { api } = setup(() => {
        throw new TypeError('Failed to fetch');
      });

      await expect(api.restore()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('si la API no responde a tiempo → NETWORK_ERROR', async () => {
      const { api } = setup(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason as Error);
            });
          }),
      );

      await expect(api.restore(20)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  });

  it('logout borra la sesión local aunque la API no responda', async () => {
    const { store, api } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    store.set(session('vigente'));

    await api.logout();

    expect(store.get()).toBeNull();
  });
});
