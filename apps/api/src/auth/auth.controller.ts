import { Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  loginSchema,
  type LoginInput,
  type SessionResponse,
  type SessionView,
} from '@hato/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentScope, CurrentSession } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Public } from '../common/farm-scope/public.decorator.js';
import { ZodBody } from '../common/validation/zod-validation.pipe.js';
import { AuthService, type RequestContext, type Session } from './auth.service.js';
import { Clock } from '../infra/clock.service.js';
import { AllowPendingPassword } from './password-change.guard.js';
import { SessionsService } from './sessions.service.js';

/**
 * Endpoints de autenticación (05-api.md «Autenticación»).
 *
 * El token de refresco viaja en una cookie `HttpOnly`, no en el cuerpo: así el JavaScript de
 * la página no puede leerlo y un XSS no se lleva la sesión de 30 días
 * (04-arquitectura.md §5). El de acceso sí va en el cuerpo, para que el cliente lo guarde en
 * memoria.
 */

/** Nombre de la cookie del token de refresco. */
export const REFRESH_COOKIE = 'hato_refresh';

/** Ruta a la que se limita la cookie: no se envía en las demás peticiones. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly clock: Clock,
  ) {}

  @Public()
  @Post('auth/login')
  async login(
    @ZodBody(loginSchema) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const session = await this.auth.login(body, contextOf(request));
    return this.respondWithSession(session, reply);
  }

  @Public()
  @Post('auth/refresh')
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const session = await this.auth.refresh(
      request.cookies[REFRESH_COOKIE] ?? '',
      contextOf(request),
    );
    return this.respondWithSession(session, reply);
  }

  @AllowPendingPassword()
  @Post('auth/logout')
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logout(request.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { ok: true };
  }

  @AllowPendingPassword()
  @Post('auth/change-password')
  async changePassword(
    @ZodBody(changePasswordSchema) body: { currentPassword: string; newPassword: string },
    @CurrentScope() scope: FarmScope,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const session = await this.auth.changePassword(
      scope.userId ?? '',
      scope.farmId,
      body.currentPassword,
      body.newPassword,
      contextOf(request),
    );
    return this.respondWithSession(session, reply);
  }

  /** Sesiones abiertas del usuario (AUT-11 CA1). */
  @Get('auth/sessions')
  async listSessions(
    @CurrentScope() scope: FarmScope,
    @CurrentSession() sessionId: string,
  ): Promise<{ items: SessionView[] }> {
    return { items: await this.sessions.list(scope.userId ?? '', sessionId) };
  }

  /** Cierra una sesión propia (AUT-11 CA2). Si es la actual, equivale a salir. */
  @Post('auth/sessions/:id/revoke')
  async revokeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
    @CurrentSession() sessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true; current: boolean }> {
    await this.sessions.revoke(scope.userId ?? '', id);
    const current = id === sessionId;
    if (current) reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { ok: true, current };
  }

  /** Cierra todas las sesiones propias menos la actual (AUT-11 CA2). */
  @Post('auth/sessions/revoke-others')
  async revokeOtherSessions(
    @CurrentScope() scope: FarmScope,
    @CurrentSession() sessionId: string,
  ): Promise<{ revoked: number }> {
    return { revoked: await this.sessions.revokeOthers(scope.userId ?? '', sessionId) };
  }

  @Get('me')
  async me(@CurrentScope() scope: FarmScope): Promise<MeResponse> {
    const memberships = await this.auth.membershipsOf(scope.userId ?? '');
    const current = memberships.find((membership) => membership.farmId === scope.farmId);
    return {
      userId: scope.userId,
      farm: { id: scope.farmId, name: current?.farmName ?? '' },
      role: scope.role,
      memberships,
    };
  }

  /** Deja la cookie de refresco y devuelve el cuerpo sin el token de refresco dentro. */
  private respondWithSession(session: Session, reply: FastifyReply): SessionResponse {
    reply.setCookie(REFRESH_COOKIE, session.refreshToken.value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      // La cookie vive lo mismo que el token: 30 días desde ahora o hasta el tope (AUT-10).
      maxAge: Math.max(
        0,
        Math.floor((session.refreshToken.expiresAt.getTime() - this.clock.now().getTime()) / 1000),
      ),
    });

    return {
      accessToken: session.accessToken,
      user: session.user,
      farm: session.farm,
      role: session.role,
      memberships: session.memberships,
    };
  }
}

/** Respuesta de `GET /me`. */
type MeResponse = {
  readonly userId: string | null;
  readonly farm: { readonly id: string; readonly name: string };
  readonly role: string;
  readonly memberships: readonly { farmId: string; farmName: string; role: string }[];
};

/** Datos de la petición que necesita el servicio: IP y agente, nunca el cuerpo. */
function contextOf(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: userAgent === undefined ? null : userAgent.slice(0, 200),
  };
}
