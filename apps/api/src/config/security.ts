import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

import type { RequestWithScope } from '../common/farm-scope/farm-scope.types.js';
import type { Env } from './env.schema.js';

/**
 * Cabeceras seguras, CORS, cookies y límite de peticiones (04-arquitectura.md §5).
 *
 * Vive aparte de `main.ts` para que las pruebas de integración levanten la aplicación con
 * exactamente la misma configuración: una prueba contra una API sin estas defensas estaría
 * comprobando algo que no se despliega.
 *
 * Los complementos se reciben por parámetro en lugar de importarlos aquí porque así la
 * prueba puede montar la misma configuración sin duplicar la lista.
 */

/** Peticiones por minuto de un usuario autenticado (04-arquitectura.md §5). */
export const RATE_LIMIT_PER_USER = 300;

/**
 * Peticiones por minuto de una IP sin autenticar.
 *
 * Más bajo que el de usuario: quien todavía no inició sesión solo necesita `/auth/login`,
 * `/auth/refresh` y `/health`. El bloqueo por intentos fallidos de AUT-01 es aparte y va por
 * cuenta; este límite frena el barrido de contraseñas desde una misma IP contra muchas
 * cuentas, que el bloqueo por cuenta no detendría.
 */
export const RATE_LIMIT_PER_IP = 60;

/** Complementos de Fastify que hacen falta. Se inyectan para poder reusarlos en pruebas. */
export type SecurityPlugins = {
  readonly cookie: Parameters<NestFastifyApplication['register']>[0];
  readonly helmet: Parameters<NestFastifyApplication['register']>[0];
  readonly rateLimit: Parameters<NestFastifyApplication['register']>[0];
};

/** Aplica cookies, helmet, CORS y límite de peticiones. */
export async function configureSecurity(
  app: NestFastifyApplication,
  env: Env,
  plugins: SecurityPlugins,
): Promise<void> {
  await app.register(plugins.cookie, { secret: env.REFRESH_TOKEN_PEPPER });

  await app.register(plugins.helmet, {
    // La API solo devuelve JSON; una política de contenido restrictiva no estorba y protege
    // las respuestas de error que algún navegador pudiera renderizar.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(plugins.rateLimit, {
    max: (request: FastifyRequest) =>
      (request as FastifyRequest & RequestWithScope).scope === undefined
        ? RATE_LIMIT_PER_IP
        : RATE_LIMIT_PER_USER,
    timeWindow: '1 minute',
    // Por usuario cuando hay sesión; por IP mientras no la haya (login incluido).
    keyGenerator: (request: FastifyRequest) => {
      const scope = (request as FastifyRequest & RequestWithScope).scope;
      return scope?.userId ?? request.ip;
    },
    // El cuerpo lo arma el filtro de errores del proyecto, en problem+json.
    errorResponseBuilder: () => ({ statusCode: 429, error: 'Too Many Requests' }),
  });

  // `credentials: true` es indispensable: sin él el navegador no envía la cookie del token
  // de refresco y la sesión de la web (M2) no se renovaría.
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
}
