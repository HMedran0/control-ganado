import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createUserSchema,
  ROLE,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodBody } from '../common/validation/zod-validation.pipe.js';
import { UsersService, type UserView, type UserWithTemporaryPassword } from './users.service.js';

/**
 * Gestión de usuarios (05-api.md «Usuarios y finca»). Todo el controlador es de ADMIN: el
 * decorador a nivel de clase evita que un endpoint nuevo se quede sin protección por olvido.
 */
@Roles(ROLE.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@CurrentScope() scope: FarmScope): Promise<{ items: UserView[] }> {
    return { items: await this.users.list(scope.farmId) };
  }

  @Post()
  async create(
    @ZodBody(createUserSchema) body: CreateUserInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<UserWithTemporaryPassword> {
    return this.users.create(scope.farmId, scope.userId ?? '', body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateUserSchema) body: UpdateUserInput,
    @CurrentScope() scope: FarmScope,
  ): Promise<UserView> {
    return this.users.update(scope.farmId, scope.userId ?? '', id, body);
  }

  /** Cierra todas las sesiones del usuario (AUT-11 CA3): equipo perdido o prestado. */
  @Post(':id/sessions/revoke')
  async revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<{ revoked: number }> {
    return this.users.revokeSessions(scope.farmId, scope.userId ?? '', id);
  }

  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentScope() scope: FarmScope,
  ): Promise<UserWithTemporaryPassword> {
    return this.users.resetPassword(scope.farmId, scope.userId ?? '', id);
  }
}
