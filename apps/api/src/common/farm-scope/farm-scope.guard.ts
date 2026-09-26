import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, ROLE, isUuid, type Role } from '@hato/shared';

import { ENV } from '../../config/env.module.js';
import type { Env } from '../../config/env.schema.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { FarmScope, RequestWithScope } from './farm-scope.types.js';

/**
 * Resuelve el ámbito de la petición y lo deja en `request.scope`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * TEMPORAL HASTA M1. La autenticación (AUT-01 a AUT-04) llega en M1. Hasta entonces, si
 * `DEV_FAKE_AUTH=true` el ámbito se toma de las cabeceras `x-dev-farm-id` y `x-dev-role`.
 *
 * Esto **suplanta la autenticación**: cualquiera que alcance la API puede decir de qué finca
 * son los datos que pide. Por eso:
 *   1. `envSchema` rechaza `DEV_FAKE_AUTH=true` cuando `NODE_ENV=production`, así que la API
 *      no arranca (hay prueba: env.schema.spec.ts).
 *   2. Este guard vuelve a comprobarlo en tiempo de ejecución, por si alguien cambiara el
 *      esquema: en producción nunca lee las cabeceras (hay prueba: farm-scope.guard.spec.ts).
 * En M1 se reemplaza el bloque marcado por la lectura del token de acceso.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class FarmScopeGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<RequestWithScope>();
    request.scope = this.resolveScope(request);
    return true;
  }

  private resolveScope(request: RequestWithScope): FarmScope {
    // --- INICIO del mecanismo temporal (se borra en M1) ---
    const devAuthAllowed = this.env.DEV_FAKE_AUTH && this.env.NODE_ENV !== 'production';
    if (devAuthAllowed) {
      const farmId = header(request, 'x-dev-farm-id');
      const role = header(request, 'x-dev-role');
      if (farmId === undefined || !isUuid(farmId)) {
        throw new DomainError('FORBIDDEN_ROLE', {
          detail:
            'DEV_FAKE_AUTH está activo: envía la cabecera x-dev-farm-id con el UUID de la finca.',
        });
      }
      return {
        farmId,
        userId: header(request, 'x-dev-user-id') ?? null,
        role: parseRole(role),
      };
    }
    // --- FIN del mecanismo temporal ---

    throw new DomainError('AUTH_TOKEN_EXPIRED', {
      detail: 'Inicia sesión para continuar.',
    });
  }
}

function header(request: RequestWithScope, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseRole(value: string | undefined): Role {
  if (value === undefined) return ROLE.ADMIN;
  const roles: readonly string[] = Object.values(ROLE);
  if (!roles.includes(value)) {
    throw new DomainError('FORBIDDEN_ROLE', {
      detail: `La cabecera x-dev-role debe ser uno de: ${roles.join(', ')}.`,
    });
  }
  return value as Role;
}
