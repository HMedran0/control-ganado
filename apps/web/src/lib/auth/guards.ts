import type { SessionResponse } from '@hato/shared';
import { redirect } from '@tanstack/react-router';

/**
 * Guardas de navegación para los `beforeLoad` del router.
 *
 * Son solo para la experiencia: evitan mostrar pantallas que no sirven. La autoridad es la
 * API, que valida el token y lee el rol de la base en cada petición (ADR-007).
 */

/** Rutas protegidas: sin sesión → inicio de sesión; con contraseña temporal → cambio. */
export function requireSession(session: SessionResponse | null, href: string): SessionResponse {
  if (session === null) {
    throw redirect({ to: '/login', search: { redirect: safeRedirect(href) } });
  }
  if (session.user.mustChangePassword) {
    throw redirect({ to: '/change-password' });
  }
  return session;
}

/** Pantalla de cambio obligatorio: solo con sesión y solo si de verdad hace falta. */
export function requirePendingPasswordChange(session: SessionResponse | null): void {
  if (session === null) throw redirect({ to: '/login' });
  if (!session.user.mustChangePassword) throw redirect({ to: '/' });
}

/** Inicio de sesión: quien ya entró va a donde iba (o al inicio). */
export function redirectIfAuthenticated(
  session: SessionResponse | null,
  target: string | undefined,
): void {
  if (session === null) return;
  if (session.user.mustChangePassword) throw redirect({ to: '/change-password' });
  throw redirect({ href: safeRedirect(target) });
}

/**
 * Destino tras iniciar sesión, solo dentro de la aplicación.
 *
 * El valor llega en la URL (`?redirect=`), así que cualquiera puede escribirlo. Sin este
 * filtro, un enlace preparado llevaría a la persona a otro sitio justo después de escribir su
 * contraseña («redirección abierta»).
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/login') || value.startsWith('/change-password')) return '/';
  return value;
}
