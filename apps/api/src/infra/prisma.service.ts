import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { SESSION_OPTIONS } from './db-session.js';

/**
 * Tiempo máximo para conseguir una conexión del pool. Por defecto `pg` espera para siempre:
 * una conexión que se queda colgada deja la petición sin respuesta y sin rastro. Con este
 * límite la petición falla con un error que queda en el log.
 */
export const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Cliente de Prisma con el adaptador de node-postgres (ADR-04).
 *
 * Prisma 7 no lleva motor Rust: la conexión la maneja `@prisma/adapter-pg`, que recibe la
 * cadena de conexión validada del entorno (nunca un puerto fijo en el código).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Trabajo en segundo plano contra la base (`TableStatsService`), que se espera al apagar. */
  private readonly background = new Set<Promise<void>>();

  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        options: SESSION_OPTIONS,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    // Nest llama este gancho antes que los de apagado de los demás servicios: lo que corre en
    // segundo plano termina aquí, antes de cerrar las conexiones.
    await this.backgroundSettled();
    await this.$disconnect();
  }

  /** Registra una tarea en segundo plano (que ya atrapa sus errores) para esperarla al apagar. */
  track(task: Promise<void>): void {
    this.background.add(task);
    void task.finally(() => this.background.delete(task));
  }

  /** Espera las tareas en segundo plano en curso. */
  async backgroundSettled(): Promise<void> {
    await Promise.all([...this.background]);
  }

  /** Comprobación de vida de la base de datos, para `GET /health`. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
