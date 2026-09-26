/**
 * Cliente de Prisma para los scripts del seed.
 *
 * El seed corre fuera de NestJS, así que no puede usar `PrismaService` (que recibe el entorno
 * por inyección de dependencias). Monta el mismo adaptador de node-postgres con la URL que ya
 * validaron las guardas.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client.js';

/** Cliente de Prisma conectado a `databaseUrl`. Quien lo crea es quien lo desconecta. */
export function createSeedClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Tipo del cliente, para las firmas de los módulos del seed. */
export type SeedClient = PrismaClient;
