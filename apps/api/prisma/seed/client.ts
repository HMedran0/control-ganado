/**
 * Cliente de Prisma para los scripts del seed.
 *
 * El seed corre fuera de NestJS, así que no puede usar `PrismaService` (que recibe el entorno
 * por inyección de dependencias). Monta el mismo adaptador de node-postgres con la URL que ya
 * validaron las guardas.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SESSION_OPTIONS } from '../../src/infra/db-session.js';

/**
 * Cliente de Prisma conectado a `databaseUrl`, con la sesión en UTC como la API
 * (`SESSION_OPTIONS`). Quien lo crea es quien lo desconecta.
 */
export function createSeedClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, options: SESSION_OPTIONS }),
  });
}

/** Tipo del cliente, para las firmas de los módulos del seed. */
export type SeedClient = PrismaClient;
