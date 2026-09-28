import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  uuidv7,
  type LoginInput,
  type MembershipView,
  type SessionResponse,
} from '@hato/shared';

import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenService, type IssuedRefreshToken, type RefreshFamily } from './token.service.js';

/** `last_used_at` se escribe como máximo una vez por hora por sesión (AUT-11 CA4). */
const LAST_USED_GRANULARITY_MS = 60 * 60 * 1000;

/**
 * Casos de uso de autenticación (AUT-01, AUT-02, AUT-04).
 *
 * Dos reglas atraviesan todo el archivo:
 *
 * 1. **Nunca se revela qué usuarios existen.** Usuario inexistente, contraseña equivocada,
 *    cuenta desactivada y finca no permitida devuelven el mismo `AUTH_INVALID_CREDENTIALS`,
 *    y en los casos en que no hay hash que verificar se gasta el mismo tiempo contra un hash
 *    señuelo (AUT-01 CA2).
 * 2. **Ni contraseñas ni tokens salen de aquí.** No se registran en el log ni en la
 *    auditoría; del token de refresco solo se guarda su hash.
 */

/**
 * Sesión recién abierta o renovada: la respuesta pública (`SessionResponse`, contrato
 * compartido con la web en `@hato/shared`) más el token de refresco, que el controlador pone
 * en la cookie y nunca en el cuerpo.
 */
export type Session = SessionResponse & {
  readonly refreshToken: IssuedRefreshToken;
};

/** Datos de la petición que hacen falta para el bloqueo y la trazabilidad. */
export type RequestContext = {
  readonly ip: string;
  readonly userAgent: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly attempts: LoginAttemptsService,
    private readonly sessions: SessionsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Inicio de sesión (AUT-01).
   *
   * @throws {DomainError} `AUTH_ACCOUNT_LOCKED` si la cuenta está bloqueada.
   * @throws {DomainError} `AUTH_INVALID_CREDENTIALS` en cualquier otro fallo.
   */
  async login(input: LoginInput, context: RequestContext): Promise<Session> {
    const login = input.login.trim().toLowerCase();

    // El bloqueo se comprueba antes de tocar la contraseña. El intento rechazado por
    // bloqueo **no se registra**: si se registrara, prolongaría el bloqueo y cualquiera
    // podría dejar a un usuario fuera de su cuenta para siempre (ADR-007).
    //
    // Es solo por cuenta, nunca por IP: en una finca todos salen a internet por el mismo
    // router o el mismo punto de datos, así que cinco errores de un operario dejarían sin
    // acceso a todos los demás. Contra el barrido desde una IP basta el límite de peticiones.
    const lock = await this.attempts.lockStateForLogin(login);
    if (lock.locked) {
      throw new DomainError('AUTH_ACCOUNT_LOCKED');
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: login }, { email: login }] },
      include: {
        memberships: {
          where: { isActive: true },
          include: { farm: { select: { id: true, name: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    // Sin usuario no hay hash que verificar, pero se gasta el mismo tiempo igual.
    if (user === null) {
      await this.passwords.verifyDecoy(input.password);
      await this.attempts.record(login, context.ip, false);
      throw new DomainError('AUTH_INVALID_CREDENTIALS');
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, input.password);
    const memberships = user.memberships.map((membership): MembershipView => ({
      farmId: membership.farmId,
      farmName: membership.farm.name,
      role: membership.role,
    }));

    // La membresía más antigua es la finca por defecto; el `id` es UUIDv7, así que
    // ordenarlo es ordenar por fecha de creación (ADR-007).
    const membership =
      input.farmId === undefined
        ? memberships[0]
        : memberships.find((item) => item.farmId === input.farmId);

    if (!passwordOk || !user.isActive || membership === undefined) {
      await this.attempts.record(login, context.ip, false);
      await this.audit(user.id, membership?.farmId ?? memberships[0]?.farmId, false);
      throw new DomainError('AUTH_INVALID_CREDENTIALS');
    }

    await this.attempts.record(login, context.ip, true);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: this.clock.now() },
    });
    await this.audit(user.id, membership.farmId, true);

    return this.openSession({ user, membership, memberships, context });
  }

  /**
   * Rotación del token de refresco (04-arquitectura.md §5) con vencimiento deslizante (AUT-10).
   *
   * Cada refresco emite uno nuevo y revoca el anterior, en la misma transacción: nunca hay un
   * instante en que la sesión quede sin token abierto, y `AccessGuard` no corta una petición
   * que llegue justo mientras se rota. Si llega un token que ya fue rotado —o uno revocado—, se
   * revoca **toda la familia**: o alguien lo robó, o el cliente está reintentando con una copia
   * vieja; en los dos casos lo seguro es cerrar la sesión.
   *
   * @throws {DomainError} `AUTH_SESSION_MAX_AGE` (con `context.login`) solo si el token era
   *   legítimo y venció por el tope absoluto de la familia (AUT-10 CA2).
   * @throws {DomainError} `AUTH_TOKEN_EXPIRED` en cualquier otro caso, sin datos del usuario:
   *   token desconocido, revocado, reutilizado o vencido por falta de uso.
   */
  async refresh(value: string, context: RequestContext): Promise<Session> {
    const tokenHash = this.tokens.hashRefreshToken(value);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            memberships: {
              where: { isActive: true },
              include: { farm: { select: { id: true, name: true } } },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });

    if (stored === null) throw new DomainError('AUTH_TOKEN_EXPIRED');

    const now = this.clock.now();
    if (stored.revokedAt !== null) {
      // Reutilización de un token ya rotado: se cae la familia entera.
      await this.revokeFamily(stored.familyId);
      throw new DomainError('AUTH_TOKEN_EXPIRED');
    }
    if (stored.expiresAt <= now) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      });
      // Solo un token que no fue revocado ni reutilizado y cuyo vencimiento es el tope de la
      // familia lleva el usuario: la web lo muestra ya escrito (06 §5.7). Un token que venció
      // por falta de uso responde lo mismo que uno desconocido.
      const cappedAt = this.tokens.familyCapAt(stored.familyStartedAt);
      if (stored.user.isActive && stored.expiresAt.getTime() >= cappedAt.getTime()) {
        throw new DomainError('AUTH_SESSION_MAX_AGE', {
          context: { login: stored.user.username },
        });
      }
      throw new DomainError('AUTH_TOKEN_EXPIRED');
    }

    const memberships = stored.user.memberships.map((membership): MembershipView => ({
      farmId: membership.farmId,
      farmName: membership.farm.name,
      role: membership.role,
    }));
    // La sesión conserva su finca activa; si dejó de ser válida, se cierra.
    const membership = memberships.find((item) => item.farmId === stored.farmId);
    if (!stored.user.isActive || membership === undefined) {
      await this.revokeFamily(stored.familyId);
      throw new DomainError('AUTH_TOKEN_EXPIRED');
    }

    const lastUsedAt =
      now.getTime() - stored.lastUsedAt.getTime() >= LAST_USED_GRANULARITY_MS
        ? now
        : stored.lastUsedAt;

    return this.openSession({
      user: stored.user,
      membership,
      memberships,
      context,
      rotate: {
        previousId: stored.id,
        family: { id: stored.familyId, startedAt: stored.familyStartedAt },
        lastUsedAt,
      },
    });
  }

  /** Cierre de sesión (AUT-02): revoca el token de refresco que traía la cookie. */
  async logout(value: string | undefined): Promise<void> {
    if (value === undefined || value === '') return;
    const tokenHash = this.tokens.hashRefreshToken(value);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  /**
   * Cambio de contraseña (AUT-04 CA1).
   *
   * Al cambiarla se revocan **todas** las sesiones del usuario: si la cambió porque se la
   * sabían, dejar viva la sesión del intruso no tendría sentido. El cliente recibe una
   * sesión nueva en la misma respuesta, así que no tiene que volver a entrar.
   *
   * @throws {DomainError} `AUTH_INVALID_CREDENTIALS` si la contraseña actual no coincide.
   */
  async changePassword(
    userId: string,
    farmId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<Session> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { isActive: true },
          include: { farm: { select: { id: true, name: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new DomainError('AUTH_INVALID_CREDENTIALS', {
        detail: 'La contraseña actual no es correcta.',
      });
    }

    const now = this.clock.now();
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, updatedAt: now },
      });
      await this.sessions.revokeAll(userId, tx);
    });

    const memberships = user.memberships.map((membership): MembershipView => ({
      farmId: membership.farmId,
      farmName: membership.farm.name,
      role: membership.role,
    }));
    const membership = memberships.find((item) => item.farmId === farmId) ?? memberships[0];
    if (membership === undefined) throw new DomainError('AUTH_TOKEN_EXPIRED');

    await this.prisma.auditLog.create({
      data: {
        farmId: membership.farmId,
        userId,
        entity: 'User',
        entityId: userId,
        action: AUDIT_ACTION.UPDATE,
        diff: { changed: ['passwordHash'] },
        createdAt: now,
      },
    });

    return this.openSession({
      user: { ...user, mustChangePassword: false },
      membership,
      memberships,
      context,
    });
  }

  /** Membresías activas de un usuario, para `/me`. */
  async membershipsOf(userId: string): Promise<MembershipView[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, isActive: true },
      include: { farm: { select: { id: true, name: true } } },
      orderBy: { id: 'asc' },
    });
    return memberships.map((membership) => ({
      farmId: membership.farmId,
      farmName: membership.farm.name,
      role: membership.role,
    }));
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  /** Emite el par de tokens y guarda el de refresco como hash. */
  private async openSession(input: {
    user: {
      id: string;
      name: string;
      username: string;
      email: string | null;
      mustChangePassword: boolean;
    };
    membership: MembershipView;
    memberships: readonly MembershipView[];
    context: RequestContext;
    /** Rotación: token que se reemplaza, su familia y el último uso que hereda el nuevo. */
    rotate?: { previousId: string; family: RefreshFamily; lastUsedAt: Date };
  }): Promise<Session> {
    const { user, membership, memberships, context, rotate } = input;
    const now = this.clock.now();

    const refreshToken = this.tokens.issueRefreshToken(rotate?.family);
    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      farmId: membership.farmId,
      role: membership.role,
      sessionId: refreshToken.familyId,
    });

    const create = this.prisma.refreshToken.create({
      data: {
        id: refreshToken.id,
        userId: user.id,
        farmId: membership.farmId,
        tokenHash: refreshToken.tokenHash,
        familyId: refreshToken.familyId,
        familyStartedAt: refreshToken.familyStartedAt,
        lastUsedAt: rotate?.lastUsedAt ?? now,
        expiresAt: refreshToken.expiresAt,
        userAgent: context.userAgent,
        createdAt: now,
      },
    });
    if (rotate === undefined) {
      await create;
    } else {
      await this.prisma.$transaction([
        this.prisma.refreshToken.update({
          where: { id: rotate.previousId },
          data: { revokedAt: now },
        }),
        create,
      ]);
    }

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        mustChangePassword: user.mustChangePassword,
      },
      farm: { id: membership.farmId, name: membership.farmName },
      role: membership.role,
      memberships,
    };
  }

  /**
   * Deja constancia del inicio de sesión (AUD-01).
   *
   * Solo se puede auditar cuando se conoce la finca: `audit_logs.farm_id` es obligatorio. Los
   * intentos con un usuario que no existe quedan en `login_attempts` y en el log, que es
   * donde tiene sentido buscarlos (ADR-007).
   */
  private async audit(
    userId: string,
    farmId: string | undefined,
    succeeded: boolean,
  ): Promise<void> {
    if (farmId === undefined) return;
    await this.prisma.auditLog.create({
      data: {
        id: undefined,
        farmId,
        userId,
        entity: 'Session',
        entityId: uuidv7(),
        action: AUDIT_ACTION.LOGIN,
        diff: { succeeded },
        createdAt: this.clock.now(),
      },
    });
  }
}
