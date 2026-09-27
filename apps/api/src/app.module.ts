import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AccessGuard } from './auth/access.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { PasswordChangeGuard } from './auth/password-change.guard.js';
import { CatalogsModule } from './catalogs/catalogs.module.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { RolesGuard } from './common/roles/roles.guard.js';
import { EnvModule } from './config/env.module.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Módulo raíz.
 *
 * El orden de los guards importa y es el de esta lista:
 *
 * 1. `AccessGuard` verifica el token y deja el ámbito en la petición;
 * 2. `PasswordChangeGuard` corta si hay una contraseña temporal sin cambiar;
 * 3. `RolesGuard` compara el rol del ámbito con el que exige el endpoint.
 *
 * Los tres son globales, así que un módulo de negocio nuevo queda protegido en cuanto se
 * registra, sin tener que acordarse de añadirlos.
 */
@Module({
  imports: [EnvModule, InfraModule, AuthModule, UsersModule, CatalogsModule, HealthModule],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
