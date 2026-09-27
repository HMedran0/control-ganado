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
import { TokenService, type IssuedRefreshToken } from './token.service.js';

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
   * Rotación del token de refresco (04-arquitectura.md §5).
   *
   * Cada refresco emite uno nuevo y revoca el anterior. Si llega un token que ya fue rotado
   * —o uno revocado—, se revoca **toda la familia**: o alguien lo robó, o el cliente está
   * reintentando con una copia vieja; en los dos casos lo seguro es cerrar la sesión.
   *
   * @throws {DomainError} `AUTH_TOKEN_EXPIRED` si el token no sirve.
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

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: now },
    });

    return this.openSession({
      user: stored.user,
      membership,
      memberships,
      context,
      familyId: stored.familyId,
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
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, updatedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

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

  /** Revoca todas las sesiones de un usuario (desactivación, AUT-03 CA2). */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
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
    familyId?: string;
  }): Promise<Session> {
    const { user, membership, memberships, context } = input;

    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      farmId: membership.farmId,
      role: membership.role,
    });
    const refreshToken = this.tokens.issueRefreshToken(input.familyId);

    await this.prisma.refreshToken.create({
      data: {
        id: refreshToken.id,
        userId: user.id,
        farmId: membership.farmId,
        tokenHash: refreshToken.tokenHash,
        familyId: refreshToken.familyId,
        expiresAt: refreshToken.expiresAt,
        userAgent: context.userAgent,
        createdAt: this.clock.now(),
      },
    });

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
