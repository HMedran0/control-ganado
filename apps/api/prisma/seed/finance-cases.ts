/**
 * Casos de finanzas que la economía de M0.3 no tenía y que los reportes de M7 necesitan (ECO-02,
 * ECO-03, ECO-06): un gasto repartido por peso, gastos generales de la finca, un gasto anulado y
 * un avalúo a mano. Montos ficticios, coherentes con 08 §3.4 y §1.12.
 *
 * Tienen su **propio** generador y su propia fábrica de identificadores (con la marca de tiempo
 * corrida 4 días, como El Retiro y La Nueva), y se construyen al final: no mueven ningún
 * identificador ni ninguna cifra de lo que ya existía (`expected.ts`).
 */

import {
  ALLOCATION_METHOD,
  EXPENSE_TYPE,
  VALUATION_METHOD,
  allocateExpense,
  compareIsoDates,
  toIsoDate,
  type IsoDate,
} from '@hato/shared';

import type { Economics, SeedExpense, SeedValuation } from './economics.js';
import type { SeedAnimal } from './herd.js';
import type { SeedWeight } from './history.js';
import { createIdFactory } from './ids.js';
import { createRandom } from './random.js';

/** Semilla de los casos de finanzas: «FINA». */
const FINANCE_SEED = 0x4649_4e41;
const ID_EPOCH_OFFSET_MS = 4 * 86_400_000;

/** Fechas y montos de los casos (ficticios). */
export const FINANCE_CASES = {
  deworming: { date: toIsoDate('2026-09-16'), amount: '312000.00' },
  fences: { date: toIsoDate('2026-08-20'), amount: '650000.00' },
  labor: { date: toIsoDate('2026-09-05'), amount: '480000.00' },
  duplicatedSalt: {
    date: toIsoDate('2026-07-08'),
    voidedOn: toIsoDate('2026-07-09'),
    amount: '180000.00',
  },
  bullValuation: { date: toIsoDate('2026-09-01'), amount: '7200000.00' },
} as const;

/** ¿El animal estaba en la finca ese día? */
function presentOn(animal: SeedAnimal, day: IsoDate): boolean {
  return (
    compareIsoDates(animal.entryDate, day) <= 0 &&
    (animal.exitDate === null || compareIsoDates(animal.exitDate, day) > 0)
  );
}

/** Último pesaje de cada animal hasta el día, como cadena decimal. */
function weightsUpTo(weights: readonly SeedWeight[], day: IsoDate): Map<string, string> {
  const result = new Map<string, { on: IsoDate; kg: string }>();
  for (const weight of weights) {
    if (compareIsoDates(weight.weighedOn, day) > 0) continue;
    const current = result.get(weight.animalId);
    if (current === undefined || compareIsoDates(weight.weighedOn, current.on) >= 0) {
      result.set(weight.animalId, { on: weight.weighedOn, kg: weight.weightKg });
    }
  }
  return new Map([...result].map(([animalId, value]) => [animalId, value.kg]));
}

export function buildFinanceCases(
  animals: readonly SeedAnimal[],
  weights: readonly SeedWeight[],
): Pick<Economics, 'expenses' | 'valuations'> {
  const ids = createIdFactory(createRandom(FINANCE_SEED), ID_EPOCH_OFFSET_MS);
  const expenses: SeedExpense[] = [];
  const valuations: SeedValuation[] = [];
  const cases = FINANCE_CASES;

  // --- Desparasitación del lote de levante, repartida según el peso (ECO-02 CA1) ---
  const known = weightsUpTo(weights, cases.deworming.date);
  const steers = animals.filter(
    (animal) =>
      animal.lotKey === 'LEVANTE' &&
      presentOn(animal, cases.deworming.date) &&
      known.has(animal.id),
  );
  const dewormingId = ids.next();
  expenses.push({
    id: dewormingId,
    type: EXPENSE_TYPE.MEDICATION,
    occurredOn: cases.deworming.date,
    amount: cases.deworming.amount,
    description: 'Desparasitación del lote de levante',
    allocationMethod: ALLOCATION_METHOD.BY_WEIGHT,
    lotKey: 'LEVANTE',
    allocations: allocateExpense({
      totalAmount: cases.deworming.amount,
      method: ALLOCATION_METHOD.BY_WEIGHT,
      animals: steers.map((animal) => ({ animalId: animal.id, weightKg: known.get(animal.id) })),
    }).map((allocation) => ({ id: ids.next(), ...allocation })),
  });

  // --- Gastos generales de la finca: no se asignan a animales (08 §1.12) ---
  expenses.push(
    {
      id: ids.next(),
      type: EXPENSE_TYPE.OTHER,
      occurredOn: cases.fences.date,
      amount: cases.fences.amount,
      description: 'Arreglo de la cerca del potrero La Loma',
      allocationMethod: ALLOCATION_METHOD.GENERAL,
      allocations: [],
    },
    {
      id: ids.next(),
      type: EXPENSE_TYPE.OTHER,
      occurredOn: cases.labor.date,
      amount: cases.labor.amount,
      description: 'Jornales de vaquería de la primera quincena de septiembre',
      allocationMethod: ALLOCATION_METHOD.GENERAL,
      allocations: [],
    },
  );

  // --- Un bulto de sal registrado dos veces y anulado al otro día (RN-11) ---
  const paridas = animals.filter(
    (animal) => animal.lotKey === 'PARIDAS' && presentOn(animal, cases.duplicatedSalt.date),
  );
  expenses.push({
    id: ids.next(),
    type: EXPENSE_TYPE.FEED,
    occurredOn: cases.duplicatedSalt.date,
    amount: cases.duplicatedSalt.amount,
    description: 'Bulto de sal mineralizada para el lote',
    allocationMethod: ALLOCATION_METHOD.EQUAL,
    lotKey: 'PARIDAS',
    voided: { on: cases.duplicatedSalt.voidedOn, reason: 'Se registró dos veces.' },
    allocations: allocateExpense({
      totalAmount: cases.duplicatedSalt.amount,
      method: ALLOCATION_METHOD.EQUAL,
      animals: paridas.map((animal) => ({ animalId: animal.id })),
    }).map((allocation) => ({ id: ids.next(), ...allocation })),
  });

  // --- Avalúo a mano del toro reproductor (ECO-03) ---
  const bull = animals.find(
    (animal) => animal.lotKey === 'TOROS' && presentOn(animal, cases.bullValuation.date),
  );
  if (bull !== undefined) {
    valuations.push({
      id: ids.next(),
      animalId: bull.id,
      valuedOn: cases.bullValuation.date,
      amount: cases.bullValuation.amount,
      method: VALUATION_METHOD.MANUAL,
    });
  }

  return { expenses, valuations };
}
