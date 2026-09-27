import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@hato/shared';

import { IS_PUBLIC_KEY } from '../common/farm-scope/public.decorator.js';
import type { RequestWithScope } from '../common/farm-scope/farm-scope.types.js';
import { PrismaService } from '../infra/prisma.service.js';
import { TokenService } from './token.service.js';

/**
 * Resuelve el ámbito de la petición a partir del token de acceso.
 *
 * Reemplaza al `FarmScopeGuard` de M0.3, que tomaba la finca de unas cabeceras de desarrollo
 * (`DEV_FAKE_AUTH`, retirado en M1: ver docs/adr/007-autenticacion.md).
 *
 * El token prueba que alguien inició sesión, pero **no** es la autoridad sobre los permisos:
 * el rol, el estado de la cuenta y el de la membresía se leen de la base de datos en cada
 * petición. Así, desactivar a un usuario o cambiarle el rol surte efecto de inmediato y no
 * dentro de quince minutos, cuando venza su token (ADR-007). Cuesta una consulta por
 * petición, indexada por clave primaria y por el único `(user_id, farm_id)`.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<RequestWithScope>();
    const token = bearerToken(request);
    if (token === undefined) {
      throw new DomainError('AUTH_TOKEN_EXPIRED', { detail: 'Inicia sesión para continuar.' });
    }

    const claims = await this.tokens.verifyAccessToken(token);

    const membership = await this.prisma.membership.findUnique({
      where: { userId_farmId: { userId: claims.userId, farmId: claims.farmId } },
      include: { user: { select: { isActive: true, mustChangePassword: true } } },
    });

    // Membresía inexistente, membresía desactivada o cuenta desactivada: el token deja de
    // valer aunque todavía no haya vencido (AUT-03 CA2).
    if (membership === null || !membership.isActive || !membership.user.isActive) {
      throw new DomainError('AUTH_TOKEN_EXPIRED', {
        detail: 'Tu acceso a esta finca ya no está activo. Vuelve a iniciar sesión.',
      });
    }

    request.scope = {
      farmId: membership.farmId,
      userId: membership.userId,
      // El rol vigente es el de la base, no el que venía firmado en el token.
      role: membership.role,
    };
    request.mustChangePassword = membership.user.mustChangePassword;
    return true;
  }
}

/** Token del encabezado `Authorization: Bearer <token>`. */
function bearerToken(request: RequestWithScope): string | undefined {
  const header = request.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token === '') return undefined;
  return token;
}
