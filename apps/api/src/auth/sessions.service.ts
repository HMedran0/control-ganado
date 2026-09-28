import { Injectable } from '@nestjs/common';
import { describeUserAgent, DomainError, type SessionView } from '@hato/shared';

import type { Tx } from '../common/persistence.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/**
 * Sesiones abiertas de un usuario (AUT-10, AUT-11; ADR-007 decisión 6).
 *
 * Para la persona, una **sesión** es un equipo: una familia de tokens de refresco. Está abierta
 * mientras tenga un token sin revocar y sin vencer; al rotar, el token anterior se revoca y el
 * nuevo lo reemplaza en la misma transacción, así que una familia abierta tiene exactamente uno.
 *
 * Cerrar una sesión revoca su familia. `AccessGuard` consulta `isOpen` en cada petición, así
 * que el token de acceso de esa sesión deja de valer al instante, no a los quince minutos.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** ¿La sesión sigue abierta para ese usuario? */
  async isOpen(userId: string, sessionId: string): Promise<boolean> {
    const token = await this.prisma.refreshToken.findFirst({
      where: {
        familyId: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      select: { id: true },
    });
    return token !== null;
  }

  /** Sesiones abiertas del usuario, de la usada más recientemente a la más antigua. */
  async list(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: this.clock.now() } },
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
      select: { familyId: true, familyStartedAt: true, lastUsedAt: true, userAgent: true },
    });
    const seen = new Set<string>();
    const sessions: SessionView[] = [];
    for (const token of tokens) {
      // Por construcción hay uno por familia; el conjunto solo protege la lista si no fuera así.
      if (seen.has(token.familyId)) continue;
      seen.add(token.familyId);
      sessions.push({
        id: token.familyId,
        device: describeUserAgent(token.userAgent),
        startedAt: token.familyStartedAt.toISOString(),
        lastUsedAt: token.lastUsedAt.toISOString(),
        current: token.familyId === currentSessionId,
      });
    }
    return sessions;
  }

  /**
   * Cierra una sesión propia (AUT-11 CA2).
   *
   * @throws {DomainError} `NOT_FOUND` si no es una sesión abierta de este usuario.
   */
  async revoke(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId: sessionId, userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
    if (count === 0) throw new DomainError('NOT_FOUND');
  }

  /** Cierra todas las sesiones del usuario menos la actual (AUT-11 CA2). Devuelve cuántas. */
  async revokeOthers(userId: string, currentSessionId: string): Promise<number> {
    const families = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, familyId: { not: currentSessionId } },
      distinct: ['familyId'],
      select: { familyId: true },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, familyId: { not: currentSessionId } },
      data: { revokedAt: this.clock.now() },
    });
    return families.length;
  }

  /**
   * Cierra **todas** las sesiones del usuario, en todas sus fincas (AUT-10 CA3, AUT-11 CA3):
   * cambio o restablecimiento de contraseña, desactivación, pérdida de la membresía o equipo
   * perdido. Devuelve cuántas sesiones estaban abiertas.
   *
   * Recibe la transacción de quien llama cuando el cierre es parte de otro cambio.
   */
  async revokeAll(userId: string, tx: Tx = this.prisma): Promise<number> {
    const now = this.clock.now();
    const families = await tx.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      distinct: ['familyId'],
      select: { familyId: true },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return families.length;
  }
}
