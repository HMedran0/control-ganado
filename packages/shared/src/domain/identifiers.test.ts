import { describe, expect, it } from 'vitest';

import { IDENTIFIER_TYPE } from '../enums.js';
import {
  COLOMBIA_COUNTRY_CODE,
  RFID_LENGTH,
  RFID_MANUFACTURER_CODES,
  isValidRfid,
  rfidPrefixIsCommon,
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

describe('rfidPrefixIsCommon (ISO 11784, 08 §1.6)', () => {
  it('Colombia (170) y los fabricantes (900 a 998) son comunes', () => {
    expect(rfidPrefixIsCommon('170123456789012')).toBe(true);
    expect(rfidPrefixIsCommon('900123456789012')).toBe(true);
    expect(rfidPrefixIsCommon('982000123456789')).toBe(true);
    expect(rfidPrefixIsCommon('998123456789012')).toBe(true);
    expect(RFID_MANUFACTURER_CODES).toEqual({ min: 900, max: 998 });
  });

  it('los vecinos del 170, otros países, el 899 y el 999 de prueba no lo son', () => {
    for (const prefix of ['169', '171', '076', '032', '899', '999', '000']) {
      expect(rfidPrefixIsCommon(`${prefix}123456789012`), prefix).toBe(false);
    }
  });
});

describe('COLOMBIA_COUNTRY_CODE', () => {
  it('reconoce el código de país 170', () => {
    expect(COLOMBIA_COUNTRY_CODE).toBe('170');
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

  it('RFID con prefijo poco común: advertencia, no bloqueo', () => {
    const resultado = validateIdentifier(IDENTIFIER_TYPE.RFID, '076123456789012');
    expect(resultado.errorCode).toBeNull();
    expect(resultado.warnings).toEqual([
      { code: 'RFID_UNCOMMON_PREFIX', message: 'Prefijo poco común: verifica el número.' },
    ]);
  });

  it('chip de fabricante (inyectable o bolo): sin advertencia', () => {
    expect(validateIdentifier(IDENTIFIER_TYPE.RFID, '982 000 123 456 789').warnings).toEqual([]);
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
