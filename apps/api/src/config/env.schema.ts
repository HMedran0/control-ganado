import { z } from 'zod';

/**
 * Variables de entorno de la API (04-arquitectura.md §9).
 *
 * Se validan al arrancar: si falta una obligatoria o hay una combinación insegura, la API no
 * inicia (04-arquitectura.md §5). Los valores de ejemplo están en `.env.example`.
 */

const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} debe tener al menos 32 caracteres.`)
    .refine((value) => !value.startsWith('cambiar'), {
      message: `${name} sigue con el valor de ejemplo de .env.example.`,
    });

/**
 * Origen HTTP(S) completo. `z.url()` por sí solo acepta «localhost:5173», porque el
 * constructor `URL` lo interpreta como esquema «localhost:», así que se exige el protocolo.
 */
const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), {
  message: 'Debe ser una URL completa que empiece por http:// o https://.',
});

const commaSeparated = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
  .pipe(z.array(httpUrl).min(1, 'Indica al menos un origen permitido.'));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_TIMEZONE: z.string().min(1).default('America/Bogota'),

  DATABASE_URL: z
    .string()
    .startsWith('postgresql://', 'DATABASE_URL debe ser una URL de PostgreSQL.'),

  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
  REFRESH_TOKEN_PEPPER: secret('REFRESH_TOKEN_PEPPER'),

  CORS_ORIGINS: commaSeparated,
  PUBLIC_WEB_URL: httpUrl,

  /** Fecha fija de «hoy» para el seed y las pruebas deterministas (08 §3). */
  SEED_TODAY: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'SEED_TODAY debe tener el formato AAAA-MM-DD.')
    .optional(),

  // `silent` apaga el log por completo; lo usan las pruebas.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** Entorno validado. */
export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno.
 * @throws {Error} con la lista de problemas en español si algo falta o es inválido.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `La configuración de entorno no es válida; la API no puede arrancar:\n${problems}\n` +
      'Revisa tu archivo .env contra .env.example.',
  );
}
