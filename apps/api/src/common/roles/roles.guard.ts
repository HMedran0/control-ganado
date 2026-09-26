import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, type Role } from '@hato/shared';

import type { RequestWithScope } from '../farm-scope/farm-scope.types.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Comprueba el rol de la petición contra los de `@Roles`.
 *
 * Sin `@Roles`, el endpoint queda abierto a cualquier rol con ámbito de finca (la columna
 * «T» de 05-api.md). Con `@Roles`, un rol distinto recibe 403 `FORBIDDEN_ROLE`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithScope>();
    const scope = request.scope;
    if (scope === undefined || !required.includes(scope.role)) {
      throw new DomainError('FORBIDDEN_ROLE');
    }
    return true;
  }
}
