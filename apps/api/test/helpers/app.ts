import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { ModuleMetadata } from '@nestjs/common';
import { ROLE, type Role } from '@hato/shared';

import { AppModule } from '../../src/app.module.js';
import { ProblemJsonFilter } from '../../src/common/errors/problem-json.filter.js';
import { parseEnv } from '../../src/config/env.schema.js';
import { configureSecurity } from '../../src/config/security.js';
import { Clock } from '../../src/infra/clock.service.js';
import { getLogger } from '../../src/infra/logger.js';
import { TokenService } from '../../src/auth/token.service.js';

/**
 * Levanta la aplicación con la **misma** configuración global que `main.ts`: prefijo, filtro
 * de errores, guards, cookies, helmet, CORS y límite de peticiones. Si una prueba usara una
 * configuración distinta, estaría comprobando una aplicación que no existe.
 */

/**
 * Reloj controlable.
 *
 * Desde M1 el vencimiento de los tokens y el bloqueo por intentos fallidos se miden con el
 * `Clock`, así que una prueba puede adelantar el tiempo en lugar de esperar quince minutos.
 */
export class FakeClock extends Clock {
  private current: Date;

  constructor(start = new Date('2026-09-25T12:00:00.000Z')) {
    super({ APP_TIMEZONE: 'America/Bogota', SEED_TODAY: undefined } as never);
    this.current = start;
  }

  override now(): Date {
    return new Date(this.current);
  }

  /** Adelanta el reloj. */
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

/** Aplicación de prueba, con el reloj falso a mano. */
export type TestApp = {
  readonly app: NestFastifyApplication;
  readonly clock: FakeClock;
};

/** Levanta la aplicación completa. */
export async function createTestApp(
  extra: Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'> = {},
): Promise<NestFastifyApplication> {
  return (await createTestAppWithClock(extra)).app;
}

/** Igual que `createTestApp`, y además devuelve el reloj para poder adelantarlo. */
export async function createTestAppWithClock(
  extra: Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'> = {},
): Promise<TestApp> {
  const env = parseEnv(process.env);
  const logger = getLogger(env);
  const clock = new FakeClock();

  const builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule, ...(extra.imports ?? [])],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  }).overrideProvider(Clock).useValue(clock);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ loggerInstance: logger }),
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemJsonFilter(logger));
  await configureSecurity(app, env, { cookie, helmet, rateLimit });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, clock };
}

/**
 * Token de acceso firmado con el secreto de la aplicación bajo prueba.
 *
 * Se usa cuando la prueba necesita un token concreto —de otra finca, de un usuario que luego
 * se desactiva, o uno que vencerá al adelantar el reloj— sin pasar por el formulario de
 * inicio de sesión. Para el camino normal está `login`.
 */
export async function signTestToken(
  app: NestFastifyApplication,
  claims: { userId: string; farmId: string; role?: Role },
): Promise<string> {
  const tokens = app.get(TokenService);
  return tokens.signAccessToken({
    userId: claims.userId,
    farmId: claims.farmId,
    role: claims.role ?? ROLE.ADMIN,
  });
}

/** Cabecera de autorización lista para `supertest`. */
export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
