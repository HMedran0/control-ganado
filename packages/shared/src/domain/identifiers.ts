/**
 * Validación y normalización de identificadores (08 §1.6).
 *
 * - `RFID`: exactamente 15 dígitos (ISO 11784/11785, FDX-B o HDX). Bloquea si no cumple. Si
 *   el prefijo no es `170` (Colombia) ni un código de fabricante (900 a 998), advierte «Prefijo
 *   poco común: verifica el número», sin bloquear.
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

/** Códigos de fabricante del estándar ISO 11784: del 900 al 998 (el 999 es de prueba). */
export const RFID_MANUFACTURER_CODES = { min: 900, max: 998 } as const;

/**
 * ¿El prefijo del chip es el de siempre? Los tres primeros dígitos son el código de país (ISO
 * 3166, 170 para Colombia) o el de un fabricante (900 a 998), que es como vienen muchos chips
 * inyectables y bolos. Cualquier otro —otro país, el 999 de prueba— suele ser un error al
 * digitarlo o un chip que no es de la finca, y se advierte sin bloquear (08 §1.6).
 */
export function rfidPrefixIsCommon(value: string): boolean {
  const prefix = value.trim().slice(0, 3);
  if (prefix === COLOMBIA_COUNTRY_CODE) return true;
  if (!/^\d{3}$/.test(prefix)) return false;
  const code = Number(prefix);
  return code >= RFID_MANUFACTURER_CODES.min && code <= RFID_MANUFACTURER_CODES.max;
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
    warnings: rfidPrefixIsCommon(normalized) ? [] : [warning('RFID_UNCOMMON_PREFIX')],
  };
}
