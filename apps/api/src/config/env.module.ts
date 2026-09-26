import { Global, Module } from '@nestjs/common';

import { parseEnv, type Env } from './env.schema.js';

/** Token de inyección del entorno validado. */
export const ENV = Symbol('ENV');

/**
 * Entorno validado, disponible en toda la aplicación.
 *
 * Se valida una sola vez, al construir el módulo: si algo falta, Nest no llega a levantar el
 * servidor (04-arquitectura.md §5).
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => parseEnv(process.env),
    },
  ],
  exports: [ENV],
})
export class EnvModule {}
