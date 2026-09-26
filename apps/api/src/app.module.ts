import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { FarmScopeGuard } from './common/farm-scope/farm-scope.guard.js';
import { RolesGuard } from './common/roles/roles.guard.js';
import { EnvModule } from './config/env.module.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';

/**
 * Módulo raíz.
 *
 * El orden de los guards importa: `FarmScopeGuard` resuelve el ámbito y `RolesGuard` lo usa
 * para decidir. Ambos son globales, así que un módulo de negocio nuevo (M1 en adelante) queda
 * protegido en el momento en que se registra, sin tener que acordarse de añadirlos.
 *
 * Los módulos de negocio (animales, reproducción, sanidad…) llegan en M1 y siguientes.
 */
@Module({
  imports: [EnvModule, InfraModule, HealthModule],
  providers: [
    { provide: APP_GUARD, useClass: FarmScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
