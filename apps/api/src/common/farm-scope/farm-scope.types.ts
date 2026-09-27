import type { Role } from '@hato/shared';

/**
 * Ámbito de la petición: de qué finca son los datos y con qué rol se accede.
 *
 * Regla no negociable 1 de CLAUDE.md: el `farmId` sale del token, nunca del cuerpo de la
 * petición. Todo repositorio de negocio lo recibe obligatoriamente.
 */
export type FarmScope = {
  readonly farmId: string;
  /**
   * Usuario autenticado. Desde M1 siempre está: lo pone `AccessGuard` a partir del token.
   * Sigue siendo nullable porque `audit_logs.user_id` lo admite (acciones del sistema).
   */
  readonly userId: string | null;
  readonly role: Role;
};

/** Petición con el ámbito ya resuelto por `AccessGuard`. */
export type RequestWithScope = {
  scope?: FarmScope;
  /** `true` mientras el usuario no cambie su contraseña temporal (AUT-04 CA2). */
  mustChangePassword?: boolean;
  headers: Record<string, string | string[] | undefined>;
  /** Cookies ya analizadas por `@fastify/cookie`. */
  cookies?: Record<string, string | undefined>;
  /** Dirección de origen, para el bloqueo por intentos y el límite de peticiones. */
  ip?: string;
  method?: string;
  url?: string;
};
