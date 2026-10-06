import { Global, Module } from '@nestjs/common';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { Clock } from './clock.service.js';
import { LOGGER, getLogger } from './logger.js';
import { PrismaService } from './prisma.service.js';
import { TableStatsService } from './table-stats.service.js';

/** Infraestructura compartida: base de datos, reloj, logger y estadísticas del planificador. */
@Global()
@Module({
  providers: [
    PrismaService,
    Clock,
    TableStatsService,
    {
      provide: LOGGER,
      inject: [ENV],
      useFactory: (env: Env) => getLogger(env),
    },
  ],
  exports: [PrismaService, Clock, LOGGER, TableStatsService],
})
export class InfraModule {}
