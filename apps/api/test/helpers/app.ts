import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { ModuleMetadata } from '@nestjs/common';
import { ROLE, uuidv7, type Role } from '@hato/shared';

import { AppModule } from '../../src/app.module.js';
import { ProblemJsonFilter } from '../../src/common/errors/problem-json.filter.js';
import { parseEnv } from '../../src/config/env.schema.js';
import { configureSecurity, type RateLimits } from '../../src/config/security.js';
import { Clock } from '../../src/infra/clock.service.js';
import { getLogger } from '../../src/infra/logger.js';
import { PrismaService } from '../../src/infra/prisma.service.js';
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
    super({ APP_TIMEZONE: 'America/Bogota', CLOCK_FIXED_TODAY: undefined });
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

/**
 * Límite de peticiones holgado para las pruebas.
 *
 * Toda la suite sale de 127.0.0.1, así que con el límite real (60/min sin autenticar) se
 * estrangularía a sí misma. La prueba que comprueba el límite lo baja a propósito.
 */
const TEST_RATE_LIMITS: RateLimits = { perUser: 100_000, perIp: 100_000 };

/** Levanta la aplicación completa. */
export async function createTestApp(
  extra: Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'> = {},
): Promise<NestFastifyApplication> {
  return (await createTestAppWithClock(extra)).app;
}

/** Igual que `createTestApp`, y además devuelve el reloj para poder adelantarlo. */
export async function createTestAppWithClock(
  extra: Pick<ModuleMetadata, 'controllers' | 'providers' | 'imports'> = {},
  limits: RateLimits = TEST_RATE_LIMITS,
): Promise<TestApp> {
  const env = parseEnv(process.env);
  const logger = getLogger(env);
  const clock = new FakeClock();

  const builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule, ...(extra.imports ?? [])],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  })
    .overrideProvider(Clock)
    .useValue(clock);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ loggerInstance: logger }),
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemJsonFilter(logger));
  await configureSecurity(app, env, { cookie, helmet, rateLimit }, limits);

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
 *
 * Desde M4d el token pertenece a una sesión real: se guarda una familia de refresco abierta
 * (con un hash que no corresponde a ningún valor, así que no sirve para refrescar) y su id va
 * en el claim `sid`. Sin ella, `AccessGuard` lo rechazaría. Tampoco aquí hay forma de
 * fabricarse un ámbito: la sesión existe en la base como cualquier otra.
 */
export async function signTestToken(
  app: NestFastifyApplication,
  claims: { userId: string; farmId: string; role?: Role },
): Promise<string> {
  const tokens = app.get(TokenService);
  const prisma = app.get(PrismaService);
  const now = app.get(Clock).now();
  const refresh = tokens.issueRefreshToken();
  await prisma.refreshToken.create({
    data: {
      id: refresh.id,
      userId: claims.userId,
      farmId: claims.farmId,
      tokenHash: `prueba-${uuidv7()}`,
      familyId: refresh.familyId,
      familyStartedAt: now,
      lastUsedAt: now,
      expiresAt: refresh.expiresAt,
      createdAt: now,
    },
  });
  return tokens.signAccessToken({
    userId: claims.userId,
    farmId: claims.farmId,
    role: claims.role ?? ROLE.ADMIN,
    sessionId: refresh.familyId,
  });
}

/** Cabecera de autorización lista para `supertest`. */
export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
