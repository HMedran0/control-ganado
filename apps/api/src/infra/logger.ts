import { pino, type Logger, type LoggerOptions } from 'pino';

import type { Env } from '../config/env.schema.js';

/**
 * Logs estructurados en JSON con pino (04-arquitectura.md §11).
 *
 * `redact` borra los campos sensibles antes de escribir: contraseñas, tokens y cabeceras de
 * autenticación nunca llegan al log, ni siquiera al volcar un objeto completo.
 */

/** Token de inyección del logger. */
export const LOGGER = Symbol('LOGGER');

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-dev-farm-id"]',
  'req.headers["x-dev-role"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
];

/** Entorno que necesita el logger. */
export type LoggerEnv = Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>;

let instance: Logger | null = null;

/** Crea la instancia de pino. */
export function createLogger(env: LoggerEnv): Logger {
  const options: LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redactado]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  // En desarrollo se imprime legible; en producción, JSON de una línea para el recolector.
  if (env.NODE_ENV === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(options);
}

/**
 * Logger compartido por Fastify, el filtro de errores y los interceptores.
 *
 * Se memoiza porque Fastify lo necesita al construir el adaptador, antes de que exista la
 * inyección de dependencias de NestJS; así ambos usan la misma instancia y un solo flujo de
 * salida.
 */
export function getLogger(env: LoggerEnv): Logger {
  instance ??= createLogger(env);
  return instance;
}

/** Descarta la instancia memoizada. Solo para pruebas. */
export function resetLogger(): void {
  instance = null;
}
