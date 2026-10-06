import { describe, expect, it } from 'vitest';

import {
  DomainError,
  ERROR_CATALOG,
  WARNING_CATALOG,
  errorDetail,
  httpStatusFor,
  isDomainError,
  warning,
  warningMessage,
} from './errors.js';

describe('catálogo', () => {
  it('tiene los 51 códigos de error de 05-api.md implementados hasta M8b', () => {
    expect(Object.keys(ERROR_CATALOG)).toHaveLength(51);
    expect(ERROR_CATALOG.EXPORT_LIMIT_REACHED.status).toBe(429);
    expect(ERROR_CATALOG.EXPORT_IN_PROGRESS.status).toBe(429);
    expect(ERROR_CATALOG.SCALE_FILE_INVALID.status).toBe(422);
    expect(ERROR_CATALOG.SYSTEM_TEMPLATE_READONLY.status).toBe(409);
    expect(ERROR_CATALOG.EXPENSE_VOIDED.status).toBe(409);
    expect(ERROR_CATALOG.VALUATION_NO_PRICE.status).toBe(422);
  });

  it('tiene las 12 advertencias de 05-api.md implementadas hasta M6', () => {
    expect(Object.keys(WARNING_CATALOG)).toEqual([
      'WEIGHT_OUTLIER',
      'RFID_FOREIGN_COUNTRY',
      'BREEDING_AGE_LOW',
      'DAM_AGE_LOW',
      'VACCINE_AGE_OUTSIDE_WINDOW',
      'ALREADY_IN_SESSION',
      'CYCLE_OVERLAP',
      'LOT_HAS_ACTIVE_ANIMALS',
      'VACCINE_IN_ACTIVE_CYCLE',
      'IDENTIFIER_NOT_RESTORED',
      'EXPECTED_CALVING_RECALCULATED',
      'SCALE_DUPLICATE_READING',
    ]);
  });

  it('todos los mensajes están en español y terminan en punto', () => {
    for (const [code, definition] of Object.entries(ERROR_CATALOG)) {
      expect(definition.detail, code).toMatch(/[.!?]$/);
      expect(definition.status, code).toBeGreaterThanOrEqual(400);
      expect(definition.status, code).toBeLessThan(600);
    }
  });

  it('usa el estado HTTP que fija la especificación', () => {
    expect(httpStatusFor('VALIDATION_FAILED')).toBe(422);
    expect(httpStatusFor('AUTH_ACCOUNT_LOCKED')).toBe(423);
    expect(httpStatusFor('VERSION_CONFLICT')).toBe(409);
    expect(httpStatusFor('IMPORT_TOO_MANY_ROWS')).toBe(413);
    expect(httpStatusFor('RATE_LIMITED')).toBe(429);
    expect(httpStatusFor('INTERNAL_ERROR')).toBe(500);
  });
});

describe('errorDetail', () => {
  it('reemplaza los marcadores', () => {
    expect(errorDetail('ANIMAL_CODE_TAKEN', { code: '26-045' })).toBe(
      'Ya existe un animal con el código 26-045.',
    );
    expect(errorDetail('IDENTIFIER_TAKEN', { value: '170123456789012', code: '188' })).toBe(
      'El identificador 170123456789012 ya está asignado al animal 188.',
    );
    expect(errorDetail('WITHDRAWAL_ACTIVE', { date: '30/09/2026' })).toContain('30/09/2026');
  });

  it('deja el marcador visible si falta el valor', () => {
    expect(errorDetail('ANIMAL_CODE_TAKEN')).toBe('Ya existe un animal con el código {code}.');
    expect(errorDetail('ANIMAL_CODE_TAKEN', { otro: 'x' })).toContain('{code}');
  });

  it('acepta números', () => {
    expect(errorDetail('VACCINE_SEX_BLOCKED', { vaccine: 'Brucelosis RB51', sex: 'machos' })).toBe(
      'La vacuna Brucelosis RB51 no se aplica a machos.',
    );
  });
});

describe('advertencias', () => {
  it('construye código y mensaje', () => {
    expect(warning('RFID_FOREIGN_COUNTRY')).toEqual({
      code: 'RFID_FOREIGN_COUNTRY',
      message: WARNING_CATALOG.RFID_FOREIGN_COUNTRY,
    });
  });

  it('interpola los mensajes de advertencia', () => {
    expect(warningMessage('WEIGHT_OUTLIER', { weight: '512' })).toContain('512');
    expect(warningMessage('VACCINE_AGE_OUTSIDE_WINDOW', { vaccine: 'Brucelosis RB51' })).toContain(
      'Brucelosis RB51',
    );
  });
});

describe('DomainError', () => {
  it('lleva código, estado y mensaje del catálogo', () => {
    const error = new DomainError('ALLOCATION_EMPTY');
    expect(error.code).toBe('ALLOCATION_EMPTY');
    expect(error.status).toBe(422);
    expect(error.detail).toBe('Selecciona al menos un animal para repartir el gasto.');
    expect(error.message).toBe(error.detail);
    expect(error.name).toBe('DomainError');
    expect(error).toBeInstanceOf(Error);
  });

  it('interpola con params', () => {
    const error = new DomainError('ANIMAL_CODE_TAKEN', { params: { code: '26-045' } });
    expect(error.detail).toBe('Ya existe un animal con el código 26-045.');
  });

  it('permite reemplazar el mensaje, como SEX_NOT_ALLOWED', () => {
    const error = new DomainError('SEX_NOT_ALLOWED', { detail: 'El padre debe ser macho.' });
    expect(error.detail).toBe('El padre debe ser macho.');
    expect(error.status).toBe(422);
  });

  it('guarda los errores por campo y la causa', () => {
    const cause = new Error('origen');
    const error = new DomainError('VALIDATION_FAILED', {
      fieldErrors: { birthDate: ['La fecha no puede ser posterior a hoy.'] },
      cause,
    });
    expect(error.fieldErrors?.birthDate).toEqual(['La fecha no puede ser posterior a hoy.']);
    expect(error.cause).toBe(cause);
  });

  it('isDomainError distingue de otros errores', () => {
    expect(isDomainError(new DomainError('NOT_FOUND'))).toBe(true);
    expect(isDomainError(new Error('otro'))).toBe(false);
    expect(isDomainError('NOT_FOUND')).toBe(false);
  });
});
