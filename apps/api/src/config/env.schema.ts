import { isIsoDate } from '@hato/shared';
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

export const envSchema = z
  .object({
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

    /**
     * Fecha fija de «hoy» para el `Clock` de la API, **solo para pruebas** (ADR-010). En
     * producción está prohibida (ver `parseEnv`). No confundir con `SEED_TODAY`, que solo lee el
     * seed y que la API ignora.
     */
    CLOCK_FIXED_TODAY: z
      .string()
      // `boolean` explícito: sin él, TypeScript infiere el predicado y el tipo pasaría a
      // `IsoDate`; el `Clock` la convierte con `toIsoDate`, que valida otra vez.
      .refine((value): boolean => isIsoDate(value), {
        message: 'CLOCK_FIXED_TODAY debe ser una fecha real con el formato AAAA-MM-DD.',
      })
      .optional(),

    /**
     * Peticiones por minuto de una IP sin sesión (ADR-007). Por defecto 60. Solo se sube para
     * las pruebas de extremo a extremo, que hacen decenas de inicios de sesión desde una sola IP;
     * en producción se deja el valor por defecto.
     */
    RATE_LIMIT_PER_IP: z.coerce
      .number()
      .int()
      .min(1, 'RATE_LIMIT_PER_IP debe ser al menos 1.')
      .default(60),

    // `silent` apaga el log por completo; lo usan las pruebas.
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, context) => {
    // Un «hoy» fijo en producción congelaría alertas, edades y vencimientos sin que nadie lo note.
    if (env.NODE_ENV === 'production' && env.CLOCK_FIXED_TODAY !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['CLOCK_FIXED_TODAY'],
        message:
          'CLOCK_FIXED_TODAY es solo para pruebas: quítala del entorno de producción (ADR-010).',
      });
    }
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
