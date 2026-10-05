import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AlertsModule } from './alerts/alerts.module.js';
import { AnimalsModule } from './animals/animals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AccessGuard } from './auth/access.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { PasswordChangeGuard } from './auth/password-change.guard.js';
import { CatalogsModule } from './catalogs/catalogs.module.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { EntitlementsModule } from './common/entitlements/entitlements.module.js';
import { IdempotencyModule } from './common/idempotency/idempotency.module.js';
import { RolesGuard } from './common/roles/roles.guard.js';
import { EnvModule } from './config/env.module.js';
import { HealthModule } from './health/health.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { InfraModule } from './infra/infra.module.js';
import { ReproductionModule } from './reproduction/reproduction.module.js';
import { SanitaryModule } from './sanitary/sanitary.module.js';
import { UsersModule } from './users/users.module.js';
import { WeightsModule } from './weights/weights.module.js';
import { FinanceModule } from './finance/finance.module.js';

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
  imports: [
    EnvModule,
    InfraModule,
    IdempotencyModule,
    EntitlementsModule,
    AuthModule,
    UsersModule,
    CatalogsModule,
    AnimalsModule,
    ReproductionModule,
    SanitaryModule,
    WeightsModule,
    FinanceModule,
    AlertsModule,
    ImportsModule,
    AuditModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
