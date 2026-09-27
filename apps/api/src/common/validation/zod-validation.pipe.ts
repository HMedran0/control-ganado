import { Body, Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { DomainError } from '@hato/shared';
import { z } from 'zod';

/**
 * Valida el cuerpo, los parámetros o la query con un esquema zod de `@hato/shared`
 * (ADR-05: el mismo esquema valida el formulario en la web y la petición en la API).
 *
 * Un fallo se traduce a `VALIDATION_FAILED` con los errores por campo, que es lo que el
 * formulario necesita para marcar cada campo (05-api.md, catálogo de errores).
 *
 * Nota: ADR-05 mencionaba `nestjs-zod`, pero su versión 5.5.0 declara peers de NestJS 10 y 11
 * (no soporta NestJS 12) y además exige `@nestjs/swagger`. Ver docs/adr/005-api-esm.md.
 */
@Injectable()
export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: z.ZodType<TOutput>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): TOutput {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: toFieldErrors(result.error),
    });
  }
}

/** Agrupa los problemas de zod por campo: `{ birthDate: ['...'], 'calves.0.code': ['...'] }`. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? '_' : issue.path.join('.');
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/**
 * Atajo para validar el cuerpo con un esquema de `@hato/shared`:
 * `metodo(@ZodBody(loginSchema) body: LoginInput)`.
 */
export function ZodBody<TOutput>(schema: z.ZodType<TOutput>): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}
