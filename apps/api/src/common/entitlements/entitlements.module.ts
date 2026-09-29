import { Global, Module } from '@nestjs/common';

import { EntitlementsService, PLAN_RESOLVER, pilotPlanResolver } from './entitlements.service.js';

/** Límites por plan (ADR-013). Global: cualquier módulo que crea animales o usuarios lo usa. */
@Global()
@Module({
  providers: [EntitlementsService, { provide: PLAN_RESOLVER, useValue: pilotPlanResolver }],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
