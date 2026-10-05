/**
 * Reparto de gastos compartidos entre animales (RN-17).
 *
 * La suma de las asignaciones es **exactamente** el monto del gasto; el residuo del redondeo
 * se suma a la primera asignación.
 *
 * **Orden determinista (ADR-016):** los animales se ordenan por `animalId` (el UUIDv7 en texto y
 * minúsculas, el mismo orden que `ORDER BY id` de PostgreSQL sobre `uuid`) y el residuo va
 * siempre al primero de ese orden. El mismo gasto con los mismos animales da siempre el mismo
 * reparto, lleguen en el orden que lleguen.
 *
 * El reparto se hace en **pesos enteros**: en Colombia no circulan centavos y RNF-13 muestra
 * los montos sin decimales, así que repartir $100.000 entre 3 da 33.334 + 33.333 + 33.333 y
 * no 33.333,34. Si el monto trae centavos, van completos a la primera asignación. Todo el
 * cálculo se hace con `bigint`; nunca con punto flotante.
 */

import { DomainError } from '../errors.js';
import { ALLOCATION_METHOD, type AllocationMethod } from '../enums.js';
import { CENTS_PER_PESO, formatMoneyValue, parseMoney, type MoneyString } from '../money.js';

/** Animal que recibe parte del gasto. */
export type AllocationTarget = {
  readonly animalId: string;
  /** Último peso en kg como cadena decimal; obligatorio con `BY_WEIGHT`. */
  readonly weightKg?: string | null;
};

/** Asignación resultante. */
export type ExpenseAllocation = {
  readonly animalId: string;
  /** Monto con dos decimales, listo para `numeric(14,2)`. */
  readonly amount: MoneyString;
};

/** Entrada de `allocateExpense`. */
export type AllocateExpenseInput = {
  /** Monto total del gasto, como cadena decimal. */
  readonly totalAmount: MoneyString;
  /** `EQUAL` (partes iguales) o `BY_WEIGHT` (proporcional al peso). */
  readonly method: Extract<AllocationMethod, 'EQUAL' | 'BY_WEIGHT'>;
  readonly animals: readonly AllocationTarget[];
};

const WEIGHT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

/** Peso en gramos, como `bigint`, para repartir sin punto flotante; `null` si no sirve. */
function weightInGrams(target: AllocationTarget): bigint | null {
  const raw = target.weightKg;
  if (raw === null || raw === undefined || !WEIGHT_PATTERN.test(raw.trim())) return null;
  const [whole = '0', fraction = ''] = raw.trim().split('.');
  const grams = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return grams === 0n ? null : grams;
}

/** Orden del reparto: por `animalId`, comparando unidades de código (sin configuración regional). */
export function compareAllocationOrder(a: { animalId: string }, b: { animalId: string }): number {
  return a.animalId < b.animalId ? -1 : a.animalId > b.animalId ? 1 : 0;
}

/**
 * Reparte un gasto entre animales (RN-17). Las asignaciones salen ordenadas por `animalId` y el
 * residuo va a la primera.
 *
 * @throws {DomainError} `ALLOCATION_EMPTY` si no hay animales.
 * @throws {DomainError} `VALIDATION_FAILED` si un animal aparece dos veces.
 * @throws {DomainError} `ALLOCATION_NO_WEIGHT` si el método es `BY_WEIGHT` y algún animal no
 *   tiene peso registrado o su peso es cero; `context.animalIds` los lista separados por comas.
 */
export function allocateExpense(input: AllocateExpenseInput): ExpenseAllocation[] {
  if (input.animals.length === 0) throw new DomainError('ALLOCATION_EMPTY');
  const animals = [...input.animals].sort(compareAllocationOrder);
  for (let index = 1; index < animals.length; index += 1) {
    if (animals[index]?.animalId === animals[index - 1]?.animalId) {
      throw new DomainError('VALIDATION_FAILED', {
        detail: 'Un animal aparece dos veces en el reparto del gasto.',
      });
    }
  }

  const totalCents = parseMoney(input.totalAmount);
  const count = BigInt(animals.length);

  // Cuota de cada animal, truncada a pesos enteros.
  const shares: bigint[] =
    input.method === ALLOCATION_METHOD.BY_WEIGHT
      ? sharesByWeight(totalCents, animals)
      : sharesEqually(totalCents, count, animals.length);

  const assigned = shares.reduce((sum, share) => sum + share, 0n);
  const remainder = totalCents - assigned;

  return animals.map((animal, index) => ({
    animalId: animal.animalId,
    amount: formatMoneyValue((shares[index] ?? 0n) + (index === 0 ? remainder : 0n)),
  }));
}

function sharesEqually(totalCents: bigint, count: bigint, length: number): bigint[] {
  const wholePesos = totalCents / CENTS_PER_PESO / count;
  return Array.from({ length }, () => wholePesos * CENTS_PER_PESO);
}

function sharesByWeight(totalCents: bigint, animals: readonly AllocationTarget[]): bigint[] {
  const weights = animals.map(weightInGrams);
  const missing = animals.filter((_animal, index) => weights[index] === null);
  if (missing.length > 0) {
    throw new DomainError('ALLOCATION_NO_WEIGHT', {
      context: { animalIds: missing.map((animal) => animal.animalId).join(',') },
    });
  }
  const grams = weights.map((value) => value ?? 0n);
  const totalGrams = grams.reduce((sum, value) => sum + value, 0n);
  return grams.map(
    (value) => ((totalCents * value) / totalGrams / CENTS_PER_PESO) * CENTS_PER_PESO,
  );
}
