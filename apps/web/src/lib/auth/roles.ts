import type { Role } from '@hato/shared';

/** Nombre de cada rol en la interfaz (glosario del SRS §2.2). */
export { ROLE_LABEL as ROLE_LABELS } from '@hato/shared';

/** ¿El rol está entre los permitidos? Sin lista, cualquiera puede. */
export function roleAllows(role: Role, allowed: readonly Role[] | undefined): boolean {
  return allowed === undefined || allowed.includes(role);
}
