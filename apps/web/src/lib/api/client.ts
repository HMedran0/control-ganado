import type { ChangePasswordInput, LoginInput, SessionResponse } from '@hato/shared';

import type { SessionStore } from '../auth/session-store';
import { isApiError, networkError, toApiError } from './errors';

/** Prefijo de la API. En desarrollo lo atiende el proxy de Vite; en producción, Caddy (ADR-008). */
export const API_BASE_URL = '/api/v1';

/** Tiempo máximo para restaurar la sesión al abrir la aplicación. */
export const RESTORE_TIMEOUT_MS = 10_000;

/** Nombre del candado entre pestañas para el refresco (ver `refreshOnce`). */
export const REFRESH_LOCK_NAME = 'hato-refresh';

/** Ejecuta `task` con un candado exclusivo por nombre. */
export type LockRunner = <T>(name: string, task: () => Promise<T>) => Promise<T>;

export type ApiClientOptions = {
  readonly session: SessionStore;
  readonly baseUrl?: string;
  /** `fetch` a usar; las pruebas pasan uno falso. */
  readonly fetch?: typeof fetch;
  /** Candado entre pestañas; por defecto, Web Locks si el navegador lo tiene. */
  readonly lock?: LockRunner;
  /**
   * Se llama una vez cuando la sesión se cae sin que el usuario haya salido (el refresco ya no
   * sirve). La aplicación lleva al inicio de sesión.
   */
  readonly onSessionEnd?: () => void;
};

export type RequestOptions = {
  readonly body?: unknown;
  /** `false` para las rutas públicas (`/auth/login`, `/auth/refresh`, `/health`). */
  readonly auth?: boolean;
  /** Tiempo máximo de la petición, en milisegundos. */
  readonly timeoutMs?: number;
  /** `file`: la respuesta es un archivo para descargar (`DownloadedFile`), no JSON. */
  readonly responseType?: 'json' | 'file';
};

/** Archivo que devolvió la API (exportación, plantilla), listo para `saveFile`. */
export type DownloadedFile = { readonly blob: Blob; readonly fileName: string };

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Cliente de la API (04-arquitectura.md §6, ADR-007).
 *
 * - El token de acceso sale de `SessionStore`, que vive solo en memoria.
 * - Ante un 401 `AUTH_TOKEN_EXPIRED`, refresca **una sola vez** y repite la petición. Si
 *   llegan varios 401 a la vez, todos esperan el mismo refresco.
 * - Si el refresco responde 401, la sesión terminó: se borra y se avisa con `onSessionEnd`.
 * - Las respuestas de error se convierten en `ApiError` con `code` y `detail`.
 */
export class ApiClient {
  private readonly session: SessionStore;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly lock: LockRunner;
  private readonly onSessionEnd: (() => void) | undefined;
  private refreshing: Promise<SessionResponse | null> | null = null;

  constructor(options: ApiClientOptions) {
    this.session = options.session;
    this.baseUrl = options.baseUrl ?? API_BASE_URL;
    // Sin `bind`, `fetch` del navegador falla con «Illegal invocation».
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.lock = options.lock ?? webLocks;
    this.onSessionEnd = options.onSessionEnd;
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T>(path: string, body: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  /**
   * Descarga un archivo con la sesión: `GET` o, con cuerpo (un `FormData` con el archivo
   * subido), `POST`. El token vive en memoria, así que no sirve un enlace directo.
   */
  download(path: string, body?: FormData): Promise<DownloadedFile> {
    return this.request<DownloadedFile>(body === undefined ? 'GET' : 'POST', path, {
      responseType: 'file',
      ...(body === undefined ? {} : { body }),
    });
  }

  /** Petición a la API con el manejo de sesión descrito en la clase. */
  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    const token = auth ? this.session.get()?.accessToken : undefined;

    try {
      return await this.send<T>(method, path, options, token);
    } catch (error) {
      if (!auth || !isApiError(error)) throw error;

      if (error.code === 'AUTH_PASSWORD_CHANGE_REQUIRED') {
        this.session.markPasswordChangeRequired();
        throw error;
      }
      if (error.code !== 'AUTH_TOKEN_EXPIRED') throw error;

      const renewed = await this.renewAfter(token);
      if (renewed === null) {
        this.endSession();
        throw error;
      }

      try {
        return await this.send<T>(method, path, options, renewed.accessToken);
      } catch (retryError) {
        // Un token recién emitido no puede estar vencido: si la API lo rechaza, la cuenta se
        // desactivó o perdió la membresía. No se vuelve a refrescar, para no entrar en bucle.
        if (isApiError(retryError) && retryError.code === 'AUTH_TOKEN_EXPIRED') {
          this.endSession();
        }
        throw retryError;
      }
    }
  }

  /**
   * Restaura la sesión al abrir la aplicación con la cookie de refresco.
   *
   * @returns la sesión, o `null` si la API dice que no hay (401).
   * @throws {ApiError} `NETWORK_ERROR` si no hubo respuesta en `RESTORE_TIMEOUT_MS`, o el error
   *   que haya sido: sin respuesta **no** se sabe si hay sesión, y mandar al inicio de sesión a
   *   alguien que solo perdió la señal lo obligaría a escribir la contraseña en la manga.
   */
  restore(timeoutMs = RESTORE_TIMEOUT_MS): Promise<SessionResponse | null> {
    return this.refreshOnce(timeoutMs);
  }

  /** Inicio de sesión (AUT-01). Un 401 aquí son credenciales, no un token vencido. */
  async login(input: LoginInput): Promise<SessionResponse> {
    const session = await this.post<SessionResponse>('/auth/login', input, { auth: false });
    this.session.set(session);
    return session;
  }

  /**
   * Cambio de contraseña (AUT-04). La API revoca todas las sesiones y entrega una nueva en la
   * misma respuesta (AUT-04 CA3), así que se reemplaza la sesión sin volver a entrar.
   */
  async changePassword(input: ChangePasswordInput): Promise<SessionResponse> {
    const session = await this.post<SessionResponse>('/auth/change-password', input);
    this.session.set(session);
    return session;
  }

  /**
   * Cierre de sesión (AUT-02). La sesión local se borra aunque la API no responda: quien
   * pulsa «Salir» tiene que quedar fuera en este dispositivo pase lo que pase.
   */
  async logout(): Promise<void> {
    try {
      if (this.session.get() !== null) await this.post('/auth/logout');
    } catch {
      // El refresco sigue vivo en el servidor hasta vencer; aquí ya no se puede hacer más.
    } finally {
      this.session.clear();
    }
  }

  /**
   * Obtiene un token válido después de un 401 con `usedToken`.
   *
   * Si mientras tanto otra petición ya refrescó, el token actual es distinto del que falló y
   * basta con reintentar con él: no hace falta gastar otra rotación.
   *
   * Si el refresco falla por red, el error sube tal cual y la sesión **no** se cierra: sin
   * respuesta no se sabe si sigue viva.
   */
  private renewAfter(usedToken: string | undefined): Promise<SessionResponse | null> {
    const current = this.session.get();
    if (current !== null && current.accessToken !== usedToken) return Promise.resolve(current);
    return this.refreshOnce();
  }

  /**
   * Un solo refresco a la vez.
   *
   * - **Dentro de la pestaña:** todas las peticiones que reciben 401 al mismo tiempo comparten
   *   la misma promesa.
   * - **Entre pestañas:** la API revoca toda la familia de sesiones si recibe un token de
   *   refresco ya rotado (ADR-007). Si dos pestañas refrescaran a la vez con la misma cookie,
   *   la segunda cerraría la sesión de ambas. El candado de Web Locks hace que la segunda
   *   espere; cuando entra, el navegador ya tiene la cookie rotada por la primera.
   */
  private refreshOnce(timeoutMs?: number): Promise<SessionResponse | null> {
    this.refreshing ??= this.lock(REFRESH_LOCK_NAME, () => this.doRefresh(timeoutMs)).finally(
      () => {
        this.refreshing = null;
      },
    );
    return this.refreshing;
  }

  private async doRefresh(timeoutMs?: number): Promise<SessionResponse | null> {
    try {
      const session = await this.send<SessionResponse>(
        'POST',
        '/auth/refresh',
        { auth: false, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
        undefined,
      );
      this.session.set(session);
      return session;
    } catch (error) {
      // Solo un 401 significa «no hay sesión». Cualquier otra cosa se propaga. La sesión
      // local la borra quien llamó (`endSession`), para avisar una sola vez.
      if (isApiError(error) && error.status === 401) {
        // Tope de la sesión deslizante (AUT-10 CA2): se recuerda quién era para pedirle solo
        // la contraseña. La API manda el usuario únicamente en este caso.
        const login = error.context?.login;
        if (error.code === 'AUTH_SESSION_MAX_AGE' && login !== undefined) {
          this.session.requireReauth(login);
        }
        return null;
      }
      throw error;
    }
  }

  /** La sesión se cayó sola: se borra y se avisa una vez, aunque fallen varias peticiones. */
  private endSession(): void {
    const hadSession = this.session.get() !== null;
    this.session.clear();
    if (hadSession) this.onSessionEnd?.();
  }

  private async send<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    token: string | undefined,
  ): Promise<T> {
    const isFile = options.responseType === 'file';
    // Con `FormData` el navegador pone el `content-type` con su separador; no se toca.
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: Record<string, string> = { accept: isFile ? '*/*' : 'application/json' };
    if (options.body !== undefined && !isForm) headers['content-type'] = 'application/json';
    if (token !== undefined) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body:
          options.body === undefined ? null : isForm ? options.body : JSON.stringify(options.body),
        // La cookie del refresco solo viaja al mismo origen (ADR-008).
        credentials: 'same-origin',
        signal: options.timeoutMs === undefined ? null : AbortSignal.timeout(options.timeoutMs),
      });
    } catch (cause) {
      // Sin red, DNS, conexión rechazada o tiempo agotado (`TimeoutError`).
      throw networkError(cause);
    }

    if (!response.ok) throw await toApiError(response);
    if (isFile) {
      const file: DownloadedFile = {
        blob: await response.blob(),
        fileName: fileNameOf(response.headers.get('content-disposition')) ?? 'archivo',
      };
      return file as T;
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** Nombre del archivo en `content-disposition: attachment; filename="…"`. */
export function fileNameOf(header: string | null): string | null {
  if (header === null) return null;
  const match = /filename="([^"]+)"/.exec(header) ?? /filename=([^;]+)/.exec(header);
  return match?.[1]?.trim() ?? null;
}

/** Candado con Web Locks; sin soporte en el navegador, ejecuta la tarea sin candado. */
const webLocks: LockRunner = (name, task) => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) return task();
  return locks.request(name, { mode: 'exclusive' }, task);
};
