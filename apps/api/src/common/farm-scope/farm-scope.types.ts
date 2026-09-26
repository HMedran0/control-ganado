import type { Role } from '@hato/shared';

/**
 * Ámbito de la petición: de qué finca son los datos y con qué rol se accede.
 *
 * Regla no negociable 1 de CLAUDE.md: el `farmId` sale del token, nunca del cuerpo de la
 * petición. Todo repositorio de negocio lo recibe obligatoriamente.
 */
export type FarmScope = {
  readonly farmId: string;
  readonly userId: string | null;
  readonly role: Role;
};

/** Petición con el ámbito ya resuelto por `FarmScopeGuard`. */
export type RequestWithScope = {
  scope?: FarmScope;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};
