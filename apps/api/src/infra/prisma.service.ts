import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Cliente de Prisma con el adaptador de node-postgres (ADR-04).
 *
 * Prisma 7 no lleva motor Rust: la conexión la maneja `@prisma/adapter-pg`, que recibe la
 * cadena de conexión validada del entorno (nunca un puerto fijo en el código).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Comprobación de vida de la base de datos, para `GET /health`. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
