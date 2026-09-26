import { DEFAULT_FARM_SETTINGS, ERROR_CATALOG } from '@hato/shared';

/**
 * Punto de entrada de la API.
 *
 * En M0.3 se reemplaza por el arranque real de NestJS sobre Fastify
 * (`NestFactory.create(AppModule, new FastifyAdapter())`), con validación de las
 * variables de entorno, el filtro de errores problem+json que traduce `ERROR_CATALOG`
 * y el endpoint /health.
 *
 * Por ahora solo comprueba que el enlace del workspace con `@hato/shared` funciona.
 */
export function describeApi(): string {
  const errorCount = Object.keys(ERROR_CATALOG).length;
  return `Hato API — pendiente del hito M0.3 (${errorCount} códigos de error, destete a los ${DEFAULT_FARM_SETTINGS.weaningAgeMonths} meses)`;
}
