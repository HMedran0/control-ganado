import { SHARED_PACKAGE_NAME } from '@hato/shared';

/**
 * Punto de entrada de la API.
 *
 * En M0.2 se reemplaza por el arranque real de NestJS sobre Fastify
 * (`NestFactory.create(AppModule, new FastifyAdapter())`), con validación de las
 * variables de entorno, filtro de errores problem+json y el endpoint /health de M0.3.
 *
 * Por ahora solo comprueba que el enlace del workspace con `@hato/shared` funciona.
 */
export function describeApi(): string {
  return `Hato API — pendiente del hito M0.2 (usa ${SHARED_PACKAGE_NAME})`;
}
