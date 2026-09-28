/**
 * Cuerpo de error `application/problem+json` (RFC 9457), tal como lo consumen la web y el
 * móvil: `code` estable para decidir y `detail` en español listo para mostrar
 * (04-arquitectura.md §4, CLAUDE.md regla 10).
 */
export type ProblemDetails = {
  /** URI que identifica el tipo de problema. */
  readonly type: string;
  /** Resumen legible del tipo de problema. */
  readonly title: string;
  /** Estado HTTP, repetido en el cuerpo como pide la RFC. */
  readonly status: number;
  /** Explicación en español de este caso concreto. */
  readonly detail: string;
  /** Código estable del catálogo de `@hato/shared`. */
  readonly code: string;
  /** Ruta que produjo el error. */
  readonly instance?: string;
  /** Datos del caso para la interfaz: por ejemplo, qué animal tiene un identificador. */
  readonly context?: Readonly<Record<string, string>>;
  /** Errores por campo, para las validaciones. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  /** Identificador de la petición, para cruzar con los logs. */
  readonly requestId?: string;
};

/** Prefijo de las URI de tipo de problema. */
export const PROBLEM_TYPE_BASE = 'https://hato.app/problems';

/** `VALIDATION_FAILED` → `https://hato.app/problems/validation-failed`. */
export function problemTypeFor(code: string): string {
  return `${PROBLEM_TYPE_BASE}/${code.toLowerCase().replace(/_/g, '-')}`;
}
