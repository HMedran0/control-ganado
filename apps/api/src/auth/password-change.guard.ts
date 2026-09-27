import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@hato/shared';

import type { RequestWithScope } from '../common/farm-scope/farm-scope.types.js';

/** Marca los endpoints que un usuario con contraseña temporal todavía puede usar. */
export const ALLOWS_PENDING_PASSWORD = 'allowsPendingPassword';

/**
 * Permite el endpoint aunque el usuario tenga la contraseña temporal sin cambiar.
 * Solo lo llevan `POST /auth/change-password` y `POST /auth/logout`.
 */
export const AllowPendingPassword = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWS_PENDING_PASSWORD, true);

/**
 * Corta el paso mientras la contraseña temporal no se haya cambiado (AUT-04 CA2).
 *
 * El usuario que recibió una contraseña temporal del administrador solo puede hacer dos
 * cosas: cambiarla o salir. Cualquier otra ruta responde `AUTH_PASSWORD_CHANGE_REQUIRED`,
 * que la web usa para llevarlo a la pantalla de cambio.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithScope>();
    if (request.mustChangePassword !== true) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWS_PENDING_PASSWORD, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed === true) return true;

    throw new DomainError('AUTH_PASSWORD_CHANGE_REQUIRED');
  }
}
