/**
 * Contabilidad básica por animal (ECO-03, ECO-05, RN-18). Solo ADMIN (RN-20): estas funciones
 * las usa la API para armar la pestaña Costos y el reporte económico, nunca para otro rol.
 *
 * Todo en centavos (`bigint`) y de vuelta a la cadena con dos decimales de `numeric(14,2)`.
 */

import { EXPENSE_TYPE, type ExpenseType } from '../enums.js';
import { DomainError } from '../errors.js';
import { CENTS_PER_PESO, formatMoneyValue, parseMoney, type MoneyString } from '../money.js';

/** Una asignación de gasto cargada al animal, con el tipo del gasto y si cuenta. */
export type InvestmentLine = {
  readonly type: ExpenseType;
  readonly amount: MoneyString;
  /** Anulada ella o su gasto: no cuenta (RN-18). */
  readonly voided: boolean;
};

/** Inversión del animal (RN-18): la compra es una asignación más. */
export type AnimalInvestment = {
  readonly total: MoneyString;
  /** Solo los tipos con asignaciones vigentes, en el orden de `EXPENSE_TYPE` (ECO-05 CA2). */
  readonly byType: readonly { readonly type: ExpenseType; readonly amount: MoneyString }[];
};

/** Suma de las asignaciones vigentes, total y por tipo de gasto (RN-18, ECO-05). */
export function animalInvestment(lines: readonly InvestmentLine[]): AnimalInvestment {
  const byType = new Map<ExpenseType, bigint>();
  let total = 0n;
  for (const line of lines) {
    if (line.voided) continue;
    const cents = parseMoney(line.amount);
    total += cents;
    byType.set(line.type, (byType.get(line.type) ?? 0n) + cents);
  }
  return {
    total: formatMoneyValue(total),
    byType: Object.values(EXPENSE_TYPE)
      .filter((type) => byType.has(type))
      .map((type) => ({ type, amount: formatMoneyValue(byType.get(type) ?? 0n) })),
  };
}

/** De dónde sale el resultado: la venta, o el último avalúo si el animal sigue en la finca. */
export type ResultBasis = 'SALE' | 'VALUATION';

export type AnimalResult = {
  readonly basis: ResultBasis;
  /** Venta (o avalúo) − inversión (RN-18). Negativo es pérdida. */
  readonly amount: MoneyString;
};

/**
 * Resultado del animal (ECO-05 CA1, RN-18): venta − inversión. Sin venta, el resultado estimado
 * con el último avalúo; sin ninguno de los dos, `null`.
 */
export function animalResult(input: {
  readonly investment: MoneyString;
  readonly saleAmount: MoneyString | null;
  readonly valuationAmount: MoneyString | null;
}): AnimalResult | null {
  const investment = parseMoney(input.investment);
  if (input.saleAmount !== null) {
    return { basis: 'SALE', amount: formatMoneyValue(parseMoney(input.saleAmount) - investment) };
  }
  if (input.valuationAmount !== null) {
    return {
      basis: 'VALUATION',
      amount: formatMoneyValue(parseMoney(input.valuationAmount) - investment),
    };
  }
  return null;
}

const WEIGHT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * Avalúo por precio por kilo (ECO-03 CA1): último peso × precio por kilo de su categoría, en
 * pesos enteros (mitad hacia arriba): en Colombia no circulan centavos.
 *
 * @throws {DomainError} `VALIDATION_FAILED` si el peso no es un decimal positivo.
 */
export function valuationByPricePerKg(weightKg: string, pricePerKg: MoneyString): MoneyString {
  const weight = weightKg.trim();
  if (!WEIGHT_PATTERN.test(weight)) {
    throw new DomainError('VALIDATION_FAILED', { detail: `El peso «${weightKg}» no es válido.` });
  }
  const [whole = '0', fraction = ''] = weight.split('.');
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  // centavos por kilo × centésimas de kilo / 100 = centavos; luego a pesos con redondeo.
  const cents = parseMoney(pricePerKg) * hundredths;
  const unit = 100n * CENTS_PER_PESO;
  const pesos = (cents + unit / 2n) / unit;
  return formatMoneyValue(pesos * CENTS_PER_PESO);
}
