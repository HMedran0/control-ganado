/**
 * Formato de dinero para la interfaz: pesos colombianos **sin decimales** en pantalla
 * y separador de miles con punto (RNF-13, SRS §2 R1).
 */

import { CENTS_PER_PESO, parseMoney, type MoneyString } from '../money.js';
import { groupThousands } from './number.js';

/** Opciones de `formatCop`. */
export type FormatCopOptions = {
  /** Anteponer `$ `. Por defecto, `true`. */
  readonly symbol?: boolean;
};

/** Redondea centavos a pesos enteros, al alza a partir de medio peso. */
function centsToPesosRounded(cents: bigint): bigint {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const pesos = (absolute + CENTS_PER_PESO / 2n) / CENTS_PER_PESO;
  return negative ? -pesos : pesos;
}

/** `"1250000.00"` → `"$ 1.250.000"`. Acepta la cadena de la API o centavos en `bigint`. */
export function formatCop(value: MoneyString | bigint, options: FormatCopOptions = {}): string {
  const cents = typeof value === 'bigint' ? value : parseMoney(value);
  const pesos = centsToPesosRounded(cents);
  const negative = pesos < 0n;
  const text = groupThousands(String(negative ? -pesos : pesos));
  const symbol = options.symbol ?? true;
  return `${negative ? '-' : ''}${symbol ? '$ ' : ''}${text}`;
}
