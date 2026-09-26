import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { ProblemJsonFilter } from './common/errors/problem-json.filter.js';
import { parseEnv } from './config/env.schema.js';
import { getLogger } from './infra/logger.js';

/**
 * Arranque de la API: NestJS sobre Fastify (ADR-03).
 *
 * El entorno se valida **antes** de construir la aplicación: si falta una variable, el proceso
 * termina con la lista de problemas en lugar de levantar un servidor a medio configurar
 * (04-arquitectura.md §5).
 */
export async function bootstrap(): Promise<NestFastifyApplication> {
  const env = parseEnv(process.env);
  const logger = getLogger(env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ loggerInstance: logger, genReqId: () => crypto.randomUUID() }),
    { bufferLogs: true },
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemJsonFilter(logger));
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      timezone: env.APP_TIMEZONE,
      devFakeAuth: env.DEV_FAKE_AUTH,
      seedToday: env.SEED_TODAY ?? null,
    },
    'API de Hato lista en /api/v1',
  );

  if (env.DEV_FAKE_AUTH) {
    logger.warn(
      'DEV_FAKE_AUTH está activo: la autenticación se suplanta con las cabeceras x-dev-farm-id y x-dev-role. Solo para desarrollo, hasta el hito M1.',
    );
  }

  return app;
}

// Este archivo es solo el punto de entrada: las pruebas levantan la aplicación con
// `createTestApp`, que arma el módulo por su cuenta, así que nadie lo importa. No se
// condiciona el arranque a comparar `import.meta.url` con `process.argv[1]` porque
// `nest start` invoca `node dist/main` sin extensión y la comparación nunca coincidiría.
bootstrap().catch((error: unknown) => {
  // El logger puede no existir todavía si falló la validación del entorno.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
