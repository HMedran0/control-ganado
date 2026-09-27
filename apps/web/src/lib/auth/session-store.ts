import type { SessionResponse } from '@hato/shared';

type Listener = () => void;

/**
 * Sesión actual, **solo en memoria**.
 *
 * El token de acceso nunca va a `localStorage` ni a `sessionStorage`: un XSS podría leerlo de
 * ahí. Al recargar la página se pierde, y la sesión se recupera con el token de refresco, que
 * vive en una cookie `HttpOnly` que el JavaScript no ve (ADR-007).
 *
 * Es observable para `useSyncExternalStore` y para que el router vuelva a evaluar sus
 * guardas cuando la sesión cambia.
 */
export class SessionStore {
  private current: SessionResponse | null = null;
  private readonly listeners = new Set<Listener>();

  /** Sesión actual, o `null` si nadie ha iniciado sesión. */
  readonly get = (): SessionResponse | null => this.current;

  /** Se suscribe a los cambios; devuelve la función para cancelar. */
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Guarda una sesión nueva (login, refresh o cambio de contraseña). */
  set(session: SessionResponse): void {
    this.current = session;
    this.emit();
  }

  /** Olvida la sesión. */
  clear(): void {
    if (this.current === null) return;
    this.current = null;
    this.emit();
  }

  /**
   * La API respondió `AUTH_PASSWORD_CHANGE_REQUIRED`: el administrador le asignó una
   * contraseña temporal mientras tenía la sesión abierta. Se marca para que el router lo lleve
   * a la pantalla de cambio.
   */
  markPasswordChangeRequired(): void {
    if (this.current === null || this.current.user.mustChangePassword) return;
    this.current = { ...this.current, user: { ...this.current.user, mustChangePassword: true } };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
