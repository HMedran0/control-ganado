/**
 * Dinero en pesos colombianos. Se representa como cadena decimal con dos decimales
 * (`"1250000.00"`), igual que `numeric(14,2)` en la base de datos y el JSON de la API
 * (03-modelo-datos.md §1). Nunca como `number`: 0,1 + 0,2 no es 0,3 en punto flotante.
 *
 * Para calcular se convierte a `bigint` de centavos y se vuelve a cadena al final.
 */

import { DomainError } from './errors.js';

/** Monto en pesos, como cadena decimal con hasta dos decimales. */
export type MoneyString = string;

const MONEY_PATTERN = /^-?\d{1,14}(\.\d{1,2})?$/;

/** Centavos en un peso. */
export const CENTS_PER_PESO = 100n;

/**
 * Convierte una cadena de dinero a centavos.
 * @throws {DomainError} `VALIDATION_FAILED` si no es un decimal con hasta dos decimales.
 */
export function parseMoney(value: MoneyString): bigint {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `El monto «${value}» no es un número con máximo dos decimales.`,
    });
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * CENTS_PER_PESO + BigInt(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Convierte centavos a la cadena con dos decimales que guarda la base de datos. */
export function formatMoneyValue(cents: bigint): MoneyString {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / CENTS_PER_PESO;
  const fraction = absolute % CENTS_PER_PESO;
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Convierte pesos enteros a centavos. */
export function pesosToCents(pesos: bigint): bigint {
  return pesos * CENTS_PER_PESO;
}

/** Suma montos en formato de cadena y devuelve la suma en el mismo formato. */
export function sumMoney(values: readonly MoneyString[]): MoneyString {
  return formatMoneyValue(values.reduce((total, value) => total + parseMoney(value), 0n));
}
