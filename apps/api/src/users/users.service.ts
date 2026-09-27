import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  ROLE,
  uuidv7,
  type CreateUserInput,
  type Role,
  type UpdateUserInput,
} from '@hato/shared';

import { Prisma } from '../generated/prisma/client.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { Clock } from '../infra/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/**
 * Gestión de usuarios de la finca (AUT-03, AUT-04 CA2). Solo ADMIN.
 *
 * Todo se hace dentro del ámbito de la finca del token: un administrador de La Esperanza no
 * ve ni toca a los usuarios de otra finca, aunque conozca su identificador (RN-21). Por eso
 * las consultas parten siempre de `memberships` filtrado por `farmId`, nunca de `users`.
 */

/** Usuario tal como lo devuelve la API. Nunca incluye el hash de la contraseña. */
export type UserView = {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string | null;
  readonly role: Role;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: string | null;
};

/** Resultado de crear un usuario o restablecer su contraseña. */
export type UserWithTemporaryPassword = {
  readonly user: UserView;
  /** Se muestra una sola vez: no se guarda en claro ni se vuelve a poder consultar. */
  readonly temporaryPassword: string;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly clock: Clock,
  ) {}

  /** Usuarios con membresía en la finca. */
  async list(farmId: string): Promise<UserView[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { farmId },
      include: { user: true },
      orderBy: { user: { username: 'asc' } },
    });
    return memberships.map((membership) => toView(membership.user, membership.role, membership.isActive));
  }

  /** Crea un usuario con contraseña temporal (AUT-03). */
  async create(
    farmId: string,
    actorId: string,
    input: CreateUserInput,
  ): Promise<UserWithTemporaryPassword> {
    const clash = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: input.username }, ...(input.email === null ? [] : [{ email: input.email }])],
      },
      select: { username: true },
    });
    if (clash !== null) throw new DomainError('USERNAME_TAKEN');

    const temporaryPassword = this.passwords.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const now = this.clock.now();
    const userId = uuidv7();

    const user = await this.prisma.user.create({
      data: {
        id: userId,
        name: input.name,
        username: input.username,
        email: input.email,
        passwordHash,
        mustChangePassword: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        memberships: { create: { id: uuidv7(), farmId, role: input.role, isActive: true } },
      },
    });

    await this.audit(farmId, actorId, userId, AUDIT_ACTION.CREATE, {
      username: input.username,
      role: input.role,
    });

    return {
      user: toView(user, input.role, true),
      temporaryPassword,
    };
  }

  /**
   * Edita nombre, correo, rol o estado (AUT-03).
   *
   * @throws {DomainError} `LAST_ADMIN` si dejaría a la finca sin ningún administrador activo.
   */
  async update(
    farmId: string,
    actorId: string,
    userId: string,
    input: UpdateUserInput,
  ): Promise<UserView> {
    const membership = await this.findMembership(farmId, userId);

    const nextRole = input.role ?? membership.role;
    const nextActive = input.isActive ?? (membership.isActive && membership.user.isActive);
    const losesAdmin =
      membership.role === ROLE.ADMIN &&
      membership.isActive &&
      membership.user.isActive &&
      (nextRole !== ROLE.ADMIN || !nextActive);
    if (losesAdmin) await this.assertNotLastAdmin(farmId, userId);

    if (input.email !== undefined && input.email !== null) {
      const clash = await this.prisma.user.findFirst({
        where: { email: input.email, id: { not: userId } },
        select: { id: true },
      });
      if (clash !== null) {
        throw new DomainError('USERNAME_TAKEN', { detail: 'Ya existe un usuario con ese correo.' });
      }
    }

    const now = this.clock.now();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        updatedAt: now,
      },
    });

    if (input.role !== undefined || input.isActive !== undefined) {
      await this.prisma.membership.update({
        where: { userId_farmId: { userId, farmId } },
        data: {
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });
    }

    // Un usuario desactivado pierde sus sesiones abiertas (AUT-03 CA2).
    if (input.isActive === false) await this.auth.revokeAllSessions(userId);

    await this.audit(farmId, actorId, userId, AUDIT_ACTION.UPDATE, changedFields(input));
    return toView(user, nextRole, nextActive);
  }

  /** Genera una contraseña temporal nueva y cierra las sesiones del usuario (AUT-04 CA2). */
  async resetPassword(
    farmId: string,
    actorId: string,
    userId: string,
  ): Promise<UserWithTemporaryPassword> {
    const membership = await this.findMembership(farmId, userId);

    const temporaryPassword = this.passwords.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const now = this.clock.now();

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, updatedAt: now },
    });
    await this.auth.revokeAllSessions(userId);
    await this.audit(farmId, actorId, userId, AUDIT_ACTION.UPDATE, {
      changed: ['passwordHash'],
      reason: 'reset',
    });

    return {
      user: toView(user, membership.role, membership.isActive),
      temporaryPassword,
    };
  }

  /** Membresía del usuario en la finca; 404 si no pertenece a ella (RN-21). */
  private async findMembership(farmId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { farmId, userId },
      include: { user: true },
    });
    if (membership === null) throw new DomainError('NOT_FOUND');
    return membership;
  }

  /**
   * @throws {DomainError} `LAST_ADMIN` si el usuario es el único administrador activo.
   */
  private async assertNotLastAdmin(farmId: string, userId: string): Promise<void> {
    const others = await this.prisma.membership.count({
      where: {
        farmId,
        role: ROLE.ADMIN,
        isActive: true,
        userId: { not: userId },
        user: { isActive: true },
      },
    });
    if (others === 0) throw new DomainError('LAST_ADMIN');
  }

  private async audit(
    farmId: string,
    actorId: string,
    entityId: string,
    action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION],
    diff: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        farmId,
        userId: actorId,
        entity: 'User',
        entityId,
        action,
        diff,
        createdAt: this.clock.now(),
      },
    });
  }
}

/** Qué cambió, sin valores sensibles. */
function changedFields(input: UpdateUserInput): Prisma.InputJsonObject {
  return {
    changed: Object.keys(input).filter((key) => input[key as keyof UpdateUserInput] !== undefined),
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
}

function toView(
  user: {
    id: string;
    name: string;
    username: string;
    email: string | null;
    isActive: boolean;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
  },
  role: Role,
  membershipActive: boolean,
): UserView {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role,
    isActive: user.isActive && membershipActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
