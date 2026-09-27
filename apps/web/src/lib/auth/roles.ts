import type { Role } from '@hato/shared';

/** Nombre de cada rol en la interfaz (glosario del SRS §2.2). */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  ADMIN: 'Administrador',
  OPERATOR: 'Operario',
  VET: 'Veterinario',
};

/** ¿El rol está entre los permitidos? Sin lista, cualquiera puede. */
export function roleAllows(role: Role, allowed: readonly Role[] | undefined): boolean {
  return allowed === undefined || allowed.includes(role);
}
