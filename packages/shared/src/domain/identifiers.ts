/**
 * Validación y normalización de identificadores (08 §1.6).
 *
 * - `RFID`: exactamente 15 dígitos (ISO 11784/11785). Bloquea si no cumple. Si no empieza por
 *   `170` (Colombia), advierte que parece un animal importado, pero no bloquea.
 * - `DIN`: se guarda en mayúsculas, sin espacios ni guiones. Sin patrón estricto hasta
 *   verificar el formato oficial vigente.
 * - Los demás tipos: texto libre normalizado.
 */

import { IDENTIFIER_TYPE, type IdentifierType } from '../enums.js';
import { warning, type ErrorCode, type Warning } from '../errors.js';

/** Dígitos exactos de un código RFID ISO 11784/11785. */
export const RFID_LENGTH = 15;

/** Código de país de Colombia en el estándar ISO 11784. */
export const COLOMBIA_COUNTRY_CODE = '170';

const DIGITS_ONLY = /^\d+$/;

/** ¿El valor es un RFID válido: exactamente 15 dígitos? */
export function isValidRfid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === RFID_LENGTH && DIGITS_ONLY.test(trimmed);
}

/** ¿El RFID corresponde a Colombia (empieza por 170)? */
export function isColombianRfid(value: string): boolean {
  return value.trim().startsWith(COLOMBIA_COUNTRY_CODE);
}

/**
 * Normaliza el valor de un identificador según su tipo.
 *
 * Todos los tipos se recortan, colapsan espacios internos y pasan a mayúsculas, porque la
 * unicidad por finca y tipo (RN-19) y la búsqueda exacta tienen que ver «01 234» y «01234»
 * como el mismo valor. El `DIN` y el `RFID` además pierden espacios y guiones.
 */
export function normalizeIdentifier(type: IdentifierType, value: string): string {
  const collapsed = value.trim().replace(/\s+/g, ' ').toUpperCase();
  if (type === IDENTIFIER_TYPE.DIN || type === IDENTIFIER_TYPE.RFID) {
    return collapsed.replace(/[\s-]/g, '');
  }
  return collapsed;
}

/** Resultado de `validateIdentifier`. */
export type IdentifierValidation = {
  /** Valor normalizado, listo para guardar. */
  readonly normalized: string;
  /** Código de error si el valor debe rechazarse. */
  readonly errorCode: ErrorCode | null;
  /** Advertencias no bloqueantes. */
  readonly warnings: readonly Warning[];
};

/**
 * Normaliza y valida un identificador.
 *
 * Solo el `RFID` tiene validación de formato (08 §1.6); un valor vacío se rechaza para
 * cualquier tipo, porque un identificador sin valor no identifica nada.
 */
export function validateIdentifier(type: IdentifierType, value: string): IdentifierValidation {
  const normalized = normalizeIdentifier(type, value);

  if (normalized === '') {
    return { normalized, errorCode: 'VALIDATION_FAILED', warnings: [] };
  }

  if (type !== IDENTIFIER_TYPE.RFID) {
    return { normalized, errorCode: null, warnings: [] };
  }

  if (!isValidRfid(normalized)) {
    return { normalized, errorCode: 'IDENTIFIER_INVALID_RFID', warnings: [] };
  }

  return {
    normalized,
    errorCode: null,
    warnings: isColombianRfid(normalized) ? [] : [warning('RFID_FOREIGN_COUNTRY')],
  };
}
