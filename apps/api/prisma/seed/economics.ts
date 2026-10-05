/**
 * Gastos, ventas y avalúos de la finca de referencia (08 §1.12 y §3.4).
 *
 * Todos los montos son ficticios y salen de 08 §3.4: novilla $2.800.000, bulto de sal
 * mineralizada $180.000, tratamiento individual entre $35.000 y $120.000, precio de
 * referencia en pie $7.800 por kilo.
 *
 * El reparto de los gastos compartidos lo hace `allocateExpense` de `@hato/shared`, que
 * garantiza que la suma de las asignaciones sea exactamente el monto del gasto y que el
 * residuo del redondeo caiga en la primera (RN-17). Aquí no se reparte nada a mano.
 */

import {
  ALLOCATION_METHOD,
  ageInMonths,
  allocateExpense,
  addDays,
  compareIsoDates,
  EXPENSE_TYPE,
  VALUATION_METHOD,
  type AllocationMethod,
  type ExpenseType,
  type IsoDate,
  type ValuationMethod,
} from '@hato/shared';

import { PRICE_PER_KG, type LotKey } from './catalog.js';
import type { SeedAnimal } from './herd.js';
import type { SeedWeight } from './history.js';
import { lastWeightByAnimal } from './history.js';
import type { IdFactory } from './ids.js';
import type { SeededRandom } from './random.js';

/** Gasto con sus asignaciones ya calculadas. */
export type SeedExpense = {
  readonly id: string;
  readonly type: ExpenseType;
  readonly occurredOn: IsoDate;
  readonly amount: string;
  readonly description: string;
  readonly allocationMethod: AllocationMethod;
  readonly allocations: readonly { id: string; animalId: string; amount: string }[];
  /** Lote elegido al repartir (M7); los gastos de M0.3 no lo guardan. */
  readonly lotKey?: LotKey;
  /** Anulado ese día, con sus asignaciones (M7, RN-11). */
  readonly voided?: { readonly on: IsoDate; readonly reason: string };
};

/** Venta lista para escribir. */
export type SeedSale = {
  readonly id: string;
  readonly animalId: string;
  readonly soldOn: IsoDate;
  readonly amount: string;
  readonly buyer: string;
  readonly notes: string | null;
};

/** Avalúo listo para escribir. */
export type SeedValuation = {
  readonly id: string;
  readonly animalId: string;
  readonly valuedOn: IsoDate;
  readonly amount: string;
  readonly method: ValuationMethod;
};

/** Economía completa. */
export type Economics = {
  readonly expenses: readonly SeedExpense[];
  readonly sales: readonly SeedSale[];
  readonly valuations: readonly SeedValuation[];
};

/** Monto en pesos enteros como cadena con dos decimales, que es como se guarda. */
function pesos(amount: number): string {
  return `${Math.round(amount)}.00`;
}

/**
 * Peso estimado en kilos cuando el animal no tiene ningún pesaje registrado (las vacas y los
 * toros no se pesan con cinta en esta finca). Es una estimación gruesa por edad, solo para
 * poder valorar y poner precio a una venta.
 */
function estimatedKg(animal: SeedAnimal, reference: IsoDate): number {
  const months = Math.max(0, ageInMonths(animal.birthDate, reference));
  const adult = animal.sex === 'MALE' ? 520 : 420;
  return months >= 36 ? adult : Math.round(40 + (adult - 40) * (months / 36));
}

/** Construye gastos, ventas y avalúos. */
export function buildEconomics(
  animals: readonly SeedAnimal[],
  weights: readonly SeedWeight[],
  random: SeededRandom,
  ids: IdFactory,
  today: IsoDate,
): Economics {
  const expenses: SeedExpense[] = [];
  const sales: SeedSale[] = [];
  const valuations: SeedValuation[] = [];
  const lastWeight = lastWeightByAnimal(weights);

  const direct = (
    type: ExpenseType,
    occurredOn: IsoDate,
    amount: number,
    description: string,
    animalId: string,
  ): void => {
    const id = ids.next();
    expenses.push({
      id,
      type,
      occurredOn,
      amount: pesos(amount),
      description,
      allocationMethod: ALLOCATION_METHOD.DIRECT,
      allocations: [{ id: ids.next(), animalId, amount: pesos(amount) }],
    });
  };

  const shared = (
    type: ExpenseType,
    occurredOn: IsoDate,
    amount: number,
    description: string,
    targets: readonly SeedAnimal[],
  ): void => {
    if (targets.length === 0) return;
    const id = ids.next();
    const allocations = allocateExpense({
      totalAmount: pesos(amount),
      method: ALLOCATION_METHOD.EQUAL,
      animals: targets.map((animal) => ({ animalId: animal.id })),
    });
    expenses.push({
      id,
      type,
      occurredOn,
      amount: pesos(amount),
      description,
      allocationMethod: ALLOCATION_METHOD.EQUAL,
      allocations: allocations.map((allocation) => ({
        id: ids.next(),
        animalId: allocation.animalId,
        amount: allocation.amount,
      })),
    });
  };

  // --- Compra de los reproductores y los bueyes (gasto directo) ---
  for (const animal of animals.filter((item) => item.origin === 'PURCHASED')) {
    const isBull = animal.notes?.startsWith('Reproductor') === true;
    direct(
      EXPENSE_TYPE.PURCHASE,
      animal.entryDate,
      isBull ? random.int(58, 72) * 100_000 : random.int(34, 42) * 100_000,
      isBull
        ? `Compra del toro ${animal.name ?? animal.code}`
        : `Compra del buey ${animal.name ?? animal.code}`,
      animal.id,
    );
  }

  // --- Sal mineralizada: un bulto por trimestre, repartido entre el lote (08 §1.12) ---
  const saltDays: IsoDate[] = ['2025-10-05', '2026-01-10', '2026-04-12', '2026-07-08'].map(
    (date) => date as IsoDate,
  );
  for (const day of saltDays) {
    const lot = animals.filter(
      (animal) =>
        animal.lotKey === 'PARIDAS' &&
        compareIsoDates(animal.entryDate, day) <= 0 &&
        (animal.exitDate === null || compareIsoDates(animal.exitDate, day) > 0),
    );
    shared(EXPENSE_TYPE.FEED, day, 180_000, 'Bulto de sal mineralizada para el lote', lot);
  }

  // --- Vacunación de los ciclos oficiales, repartida entre los animales vacunados ---
  const cycleDays: { day: IsoDate; label: string }[] = [
    { day: '2025-11-08' as IsoDate, label: 'ciclo 2025-2' },
    { day: '2026-05-16' as IsoDate, label: 'ciclo 2026-1' },
  ];
  for (const { day, label } of cycleDays) {
    const vaccinated = animals.filter(
      (animal) =>
        compareIsoDates(animal.entryDate, day) <= 0 &&
        (animal.exitDate === null || compareIsoDates(animal.exitDate, day) > 0),
    );
    shared(
      EXPENSE_TYPE.VACCINE,
      day,
      vaccinated.length * 3_500,
      `Vacunación del ${label} (aftosa y rabia)`,
      vaccinated,
    );
  }

  // --- Tratamientos individuales y transporte (gasto directo) ---
  const treated = random.shuffle(animals.filter((animal) => animal.exitType === null)).slice(0, 3);
  for (const animal of treated) {
    direct(
      EXPENSE_TYPE.MEDICATION,
      addDays(today, -random.int(20, 300)),
      random.int(35, 120) * 1_000,
      `Tratamiento individual del animal ${animal.code}`,
      animal.id,
    );
  }

  // --- Ventas: precio en pie sobre el último peso conocido (08 §3.4) ---
  const sold = animals.filter((animal) => animal.exitType === 'SALE');
  for (const animal of sold) {
    const soldOn = animal.exitDate;
    if (soldOn === null) continue;
    const kg = Number(lastWeight.get(animal.id) ?? estimatedKg(animal, soldOn));
    const amount = Math.round((kg * PRICE_PER_KG) / 1000) * 1000;
    sales.push({
      id: ids.next(),
      animalId: animal.id,
      soldOn,
      amount: pesos(amount),
      buyer: random.pick([
        'Comercializadora El Carmen',
        'Subasta de San Juan',
        'Frigorífico del Sur',
      ]),
      notes: `Peso en pie estimado: ${kg} kg a $${PRICE_PER_KG}/kg.`,
    });

    direct(
      EXPENSE_TYPE.TRANSPORT,
      soldOn,
      random.int(80, 140) * 1_000,
      `Transporte a la venta del animal ${animal.code}`,
      animal.id,
    );
  }

  // --- Avalúo de los animales marcados para venta ---
  for (const animal of animals.filter((item) => item.forSale)) {
    const kg = Number(lastWeight.get(animal.id) ?? estimatedKg(animal, today));
    valuations.push({
      id: ids.next(),
      animalId: animal.id,
      valuedOn: today,
      amount: pesos(kg * PRICE_PER_KG),
      method: VALUATION_METHOD.PRICE_PER_KG,
    });
  }

  return { expenses, sales, valuations };
}
