import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { fakeSession } from '../../test/auth-harness';
import {
  redirectIfAuthenticated,
  requirePendingPasswordChange,
  requireSession,
  safeRedirect,
} from './guards';

/** Ejecuta la guarda y devuelve las opciones del `redirect` que lanzó. */
function redirectOf(guard: () => unknown): Record<string, unknown> {
  try {
    guard();
  } catch (thrown) {
    if (isRedirect(thrown)) return thrown.options as Record<string, unknown>;
    throw thrown;
  }
  throw new Error('La guarda no redirigió.');
}

const pending = fakeSession({ user: { ...fakeSession().user, mustChangePassword: true } });

describe('guardas de navegación', () => {
  it('sin sesión lleva al inicio de sesión recordando a dónde iba', () => {
    expect(redirectOf(() => requireSession(null, '/animals?sexo=F'))).toMatchObject({
      to: '/login',
      search: { redirect: '/animals?sexo=F' },
    });
  });

  it('con contraseña temporal lleva al cambio obligatorio y no deja pasar', () => {
    expect(redirectOf(() => requireSession(pending, '/animals'))).toMatchObject({
      to: '/change-password',
    });
  });

  it('con sesión normal deja pasar', () => {
    const session = fakeSession();
    expect(requireSession(session, '/')).toBe(session);
  });

  it('la pantalla de cambio obligatorio solo abre si hace falta', () => {
    expect(redirectOf(() => requirePendingPasswordChange(null))).toMatchObject({ to: '/login' });
    expect(redirectOf(() => requirePendingPasswordChange(fakeSession()))).toMatchObject({
      to: '/',
    });
    expect(() => {
      requirePendingPasswordChange(pending);
    }).not.toThrow();
  });

  it('quien ya inició sesión no ve el formulario: va a donde iba', () => {
    expect(redirectOf(() => redirectIfAuthenticated(fakeSession(), '/alerts'))).toMatchObject({
      href: '/alerts',
    });
    expect(() => {
      redirectIfAuthenticated(null, '/alerts');
    }).not.toThrow();
  });

  it.each([
    ['/animals', '/animals'],
    ['/animals?sexo=F#lista', '/animals?sexo=F#lista'],
    [undefined, '/'],
    ['https://otro-sitio.example', '/'],
    ['//otro-sitio.example', '/'],
    ['/\\otro-sitio.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/login', '/'],
  ])('safeRedirect(%s) → %s', (value, expected) => {
    expect(safeRedirect(value)).toBe(expected);
  });
});
