/**
 * Reglas de la salida de un animal (ANI-04, IDN-06, RN-22, RN-32).
 */

import type { IsoDate } from '../date.js';
import { EXIT_TYPE, IDENTIFIER_TYPE, type ExitType, type IdentifierType } from '../enums.js';

/** Salidas en las que el retiro de medicamento importa: la carne llega al consumo (RN-22). */
const WITHDRAWAL_SENSITIVE_EXITS: readonly ExitType[] = [EXIT_TYPE.SALE, EXIT_TYPE.SLAUGHTER];

/**
 * ¿La salida exige confirmar el retiro vigente (ANI-04 CA3, RN-22)? Solo en venta o sacrificio, y
 * solo si el retiro llega hasta la fecha de salida o después (el último día de retiro cuenta).
 */
export function exitNeedsWithdrawalConfirmation(input: {
  readonly type: ExitType;
  readonly date: IsoDate;
  readonly withdrawalUntil: IsoDate | null;
}): boolean {
  return (
    WITHDRAWAL_SENSITIVE_EXITS.includes(input.type) &&
    input.withdrawalUntil !== null &&
    input.withdrawalUntil >= input.date
  );
}

/**
 * Tipos de identificador que se liberan al salir en una finca con numeración reutilizable
 * (IDN-06 CA1). DIN y RFID son de por vida y nunca se liberan (RN-32).
 */
export const IDENTIFIER_TYPES_RELEASED_ON_EXIT: readonly IdentifierType[] = [
  IDENTIFIER_TYPE.VISUAL_TAG,
];

/** ¿Este identificador se retira con motivo `EXITED` al registrar la salida? */
export function isReleasedOnExit(input: {
  readonly codeReuse: boolean;
  readonly type: IdentifierType;
}): boolean {
  return input.codeReuse && IDENTIFIER_TYPES_RELEASED_ON_EXIT.includes(input.type);
}
