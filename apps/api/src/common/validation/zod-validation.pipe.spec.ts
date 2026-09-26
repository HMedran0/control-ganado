import { describe, expect, it } from 'vitest';
import { DomainError, farmSettingsSchema } from '@hato/shared';
import { z } from 'zod';

import { ZodValidationPipe, toFieldErrors } from './zod-validation.pipe.js';

const metadata = { type: 'body' } as const;

describe('ZodValidationPipe', () => {
  it('devuelve el valor validado con los valores por defecto aplicados', () => {
    const pipe = new ZodValidationPipe(farmSettingsSchema);
    const result = pipe.transform({ weaningAgeMonths: 9 }, metadata);

    expect(result.weaningAgeMonths).toBe(9);
    expect(result.gestationDays).toBe(285);
  });

  it('traduce un fallo a VALIDATION_FAILED con errores por campo', () => {
    const pipe = new ZodValidationPipe(farmSettingsSchema);

    try {
      pipe.transform({ weaningAgeMonths: 0 }, metadata);
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      const domainError = error as DomainError;
      expect(domainError.code).toBe('VALIDATION_FAILED');
      expect(domainError.status).toBe(422);
      expect(domainError.detail).toBe('Revisa los campos marcados.');
      expect(domainError.fieldErrors?.weaningAgeMonths).toHaveLength(1);
    }
  });

  it('rechaza claves desconocidas, como el esquema de la finca', () => {
    const pipe = new ZodValidationPipe(farmSettingsSchema);
    expect(() => pipe.transform({ weaningAgeMonth: 7 }, metadata)).toThrow(DomainError);
  });
});

describe('toFieldErrors', () => {
  it('agrupa varios problemas del mismo campo', () => {
    const schema = z.object({ code: z.string().min(3).regex(/^\d+$/) });
    const result = schema.safeParse({ code: 'a' });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(toFieldErrors(result.error).code).toHaveLength(2);
  });

  it('usa rutas con punto para los campos anidados', () => {
    const schema = z.object({ calves: z.array(z.object({ code: z.string().min(1) })) });
    const result = schema.safeParse({ calves: [{ code: '' }] });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(Object.keys(toFieldErrors(result.error))).toEqual(['calves.0.code']);
  });

  it('agrupa bajo «_» los problemas sin campo', () => {
    const schema = z.string();
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(Object.keys(toFieldErrors(result.error))).toEqual(['_']);
  });
});
