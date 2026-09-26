import { describe, expect, it } from 'vitest';

import { IDENTIFIER_TYPE } from '../enums.js';
import {
  COLOMBIA_COUNTRY_CODE,
  RFID_LENGTH,
  isColombianRfid,
  isValidRfid,
  normalizeIdentifier,
  validateIdentifier,
} from './identifiers.js';

describe('isValidRfid (08 §1.6)', () => {
  it('acepta exactamente 15 dígitos', () => {
    expect(RFID_LENGTH).toBe(15);
    expect(isValidRfid('170123456789012')).toBe(true);
    expect(isValidRfid('  170123456789012  ')).toBe(true);
  });

  it('rechaza 14 dígitos', () => {
    expect(isValidRfid('17012345678901')).toBe(false);
  });

  it('rechaza 16 dígitos, letras y cadenas vacías', () => {
    expect(isValidRfid('1701234567890123')).toBe(false);
    expect(isValidRfid('170A23456789012')).toBe(false);
    expect(isValidRfid('')).toBe(false);
    expect(isValidRfid('170 123 456 789 012')).toBe(false);
  });
});

describe('isColombianRfid', () => {
  it('reconoce el código de país 170', () => {
    expect(COLOMBIA_COUNTRY_CODE).toBe('170');
    expect(isColombianRfid('170123456789012')).toBe(true);
    expect(isColombianRfid('076123456789012')).toBe(false);
  });
});

describe('normalizeIdentifier (08 §1.6)', () => {
  it('DIN: mayúsculas, sin espacios ni guiones', () => {
    expect(normalizeIdentifier(IDENTIFIER_TYPE.DIN, ' co-123 456 ')).toBe('CO123456');
    expect(normalizeIdentifier(IDENTIFIER_TYPE.DIN, 'co 123-456')).toBe('CO123456');
  });

  it('RFID: se queda solo con los dígitos pegados', () => {
    expect(normalizeIdentifier(IDENTIFIER_TYPE.RFID, '170 123 456 789 012')).toBe(
      '170123456789012',
    );
    expect(normalizeIdentifier(IDENTIFIER_TYPE.RFID, '170-123456789012')).toBe('170123456789012');
  });

  it('chapeta: recorta, colapsa espacios y pasa a mayúsculas', () => {
    expect(normalizeIdentifier(IDENTIFIER_TYPE.VISUAL_TAG, '  a   12  ')).toBe('A 12');
    expect(normalizeIdentifier(IDENTIFIER_TYPE.VISUAL_TAG, 'lote 3')).toBe('LOTE 3');
  });

  it('los demás tipos siguen la misma norma que la chapeta', () => {
    expect(normalizeIdentifier(IDENTIFIER_TYPE.BRAND, ' hierro  hn ')).toBe('HIERRO HN');
    expect(normalizeIdentifier(IDENTIFIER_TYPE.QR, ' abc-123 ')).toBe('ABC-123');
    expect(normalizeIdentifier(IDENTIFIER_TYPE.OTHER, '  x  ')).toBe('X');
  });

  it('es idempotente', () => {
    const una = normalizeIdentifier(IDENTIFIER_TYPE.DIN, ' co-123 456 ');
    expect(normalizeIdentifier(IDENTIFIER_TYPE.DIN, una)).toBe(una);
  });
});

describe('validateIdentifier', () => {
  it('RFID colombiano válido: sin error ni advertencias', () => {
    expect(validateIdentifier(IDENTIFIER_TYPE.RFID, '170 123 456 789 012')).toEqual({
      normalized: '170123456789012',
      errorCode: null,
      warnings: [],
    });
  });

  it('RFID de 14 dígitos: error bloqueante', () => {
    const resultado = validateIdentifier(IDENTIFIER_TYPE.RFID, '17012345678901');
    expect(resultado.errorCode).toBe('IDENTIFIER_INVALID_RFID');
    expect(resultado.warnings).toEqual([]);
  });

  it('RFID extranjero: advertencia, no bloqueo', () => {
    const resultado = validateIdentifier(IDENTIFIER_TYPE.RFID, '076123456789012');
    expect(resultado.errorCode).toBeNull();
    expect(resultado.warnings).toHaveLength(1);
    expect(resultado.warnings[0]?.code).toBe('RFID_FOREIGN_COUNTRY');
    expect(resultado.warnings[0]?.message).toContain('170');
  });

  it('valor vacío: error para cualquier tipo', () => {
    for (const type of Object.values(IDENTIFIER_TYPE)) {
      expect(validateIdentifier(type, '   ').errorCode, type).toBe('VALIDATION_FAILED');
    }
  });

  it('los tipos que no son RFID no validan formato', () => {
    expect(validateIdentifier(IDENTIFIER_TYPE.DIN, 'co-123').errorCode).toBeNull();
    expect(validateIdentifier(IDENTIFIER_TYPE.VISUAL_TAG, '188').errorCode).toBeNull();
    expect(validateIdentifier(IDENTIFIER_TYPE.BRAND, 'HN').warnings).toEqual([]);
  });
});
