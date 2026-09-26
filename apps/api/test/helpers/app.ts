import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { ModuleMetadata } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import { ProblemJsonFilter } from '../../src/common/errors/problem-json.filter.js';
import { parseEnv } from '../../src/config/env.schema.js';
import { getLogger } from '../../src/infra/logger.js';

/**
 * Levanta la aplicación con la **misma** configuración global que `main.ts`: prefijo,
 * filtro de errores y guards. Si una prueba usara una configuración distinta, estaría
 * comprobando una aplicación que no existe.
 */
export async function createTestApp(
  extra: Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'> = {},
): Promise<NestFastifyApplication> {
  const env = parseEnv(process.env);
  const logger = getLogger(env);

  const builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule, ...(extra.imports ?? [])],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  });

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ loggerInstance: logger }),
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemJsonFilter(logger));

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Cabeceras que suplantan la autenticación mientras llega M1 (`DEV_FAKE_AUTH`). */
export function devAuthHeaders(
  farmId: string,
  role = 'ADMIN',
  userId?: string,
): Record<string, string> {
  return {
    'x-dev-farm-id': farmId,
    'x-dev-role': role,
    ...(userId === undefined ? {} : { 'x-dev-user-id': userId }),
  };
}
