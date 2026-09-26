import { SetMetadata } from '@nestjs/common';
import type { Role } from '@hato/shared';

/** Clave de metadatos con los roles autorizados. */
export const ROLES_KEY = 'hato:roles';

/**
 * Restringe un endpoint a ciertos roles: `@Roles('ADMIN')`.
 *
 * La autorización vive en el servidor (CLAUDE.md, regla 2). Los datos económicos son solo de
 * ADMIN (RN-20), también cuando aparecen anidados en otros recursos.
 */
export const Roles = (...roles: readonly Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
