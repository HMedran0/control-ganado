/**
 * Casos de ceba de **Finca El Retiro** [Ficticio] (M8a): el tablero de levante y ceba (CFG-03)
 * necesita machos cerca del peso de venta (PES-06) y lotes que ganan menos de lo esperado
 * (PES-05 CA4), que los animales de M4c no tienen.
 *
 * Ocho machos comprados en junio de 2026, códigos 41 a 48 (la numeración de M4c es del 1 al 40, y
 * el menor número libre sigue siendo el 17), en dos lotes:
 *
 * - **Ceba A** (ganan bien): 41 y 42 llegan a 450 kg este mes (28/09 y 30/09); 43 ya pasó los
 *   450 kg (dato medido); 44 tiene más de 24 meses (la clasificación por edad lo llama «Toro») y
 *   también llega este mes; 45 debería estar en el peso según su ganancia, pero su último pesaje
 *   es de julio y está por debajo («pésalo para confirmar»).
 * - **Ceba B** (ganancia baja): 46 y 47 ganan menos de 0,30 kg/día y llegan después.
 * - 48 es el **toro reproductor** de la finca, con la etiqueta del sistema «Reproductor»: pesa
 *   más de 450 kg y no cuenta en el peso de venta.
 *
 * Tienen su **propio** generador y su propia fábrica de identificadores, y se construyen al final
 * de El Retiro: no mueven ningún identificador anterior. Sí suman 8 animales a su inventario
 * (`EXPECTED_RETIRO`).
 */

import { BREEDER_TAG_KEY, SEX, toIsoDate, type IsoDate, type Sex } from '@hato/shared';

import { createIdFactory } from './ids.js';
import { createRandom } from './random.js';

/** Semilla de los casos de ceba: «CEBA». */
const CEBA_SEED = 0x4345_4241;
/** Seis días después del reloj de referencia, distinto de las demás fábricas del seed. */
const ID_EPOCH_OFFSET_MS = 6 * 86_400_000;

/** Fecha de compra de los machos de ceba. */
export const CEBA_ENTRY = toIsoDate('2026-05-20');

type CebaLotKey = 'CEBA_A' | 'CEBA_B';

export const CEBA_LOTS: readonly { key: CebaLotKey; name: string; description: string }[] = [
  { key: 'CEBA_A', name: 'Ceba A', description: 'Novillos cerca del peso de venta' },
  { key: 'CEBA_B', name: 'Ceba B', description: 'Novillos de llegada reciente' },
];

type CebaSpec = {
  readonly code: string;
  readonly birth: string;
  readonly lot: CebaLotKey | null;
  readonly breeder?: boolean;
  /** Pesajes: fecha y kilos. */
  readonly weights: readonly (readonly [string, number])[];
};

/**
 * Pesajes de 0,8 kg/día entre el 15/07 y el 14/09 (61 días, 48,8 kg): con 450 kg de objetivo,
 * 438,8 kg el 14/09 llega el 28/09 y 437,6 kg, el 30/09 (PES-06, redondeo hacia arriba).
 */
const at08 = (last: number): readonly (readonly [string, number])[] => [
  ['2026-07-15', Math.round((last - 48.8) * 10) / 10],
  ['2026-09-14', last],
];

const SPECS: readonly CebaSpec[] = [
  { code: '41', birth: '2024-12-10', lot: 'CEBA_A', weights: at08(438.8) },
  { code: '42', birth: '2024-11-05', lot: 'CEBA_A', weights: at08(437.6) },
  {
    code: '43',
    birth: '2024-10-01',
    lot: 'CEBA_A',
    weights: [
      ['2026-07-15', 410],
      ['2026-09-14', 452],
    ],
  },
  { code: '44', birth: '2023-08-01', lot: 'CEBA_A', weights: at08(438.8) },
  {
    code: '45',
    birth: '2024-12-20',
    lot: 'CEBA_A',
    weights: [
      ['2026-06-01', 400],
      ['2026-07-20', 445],
    ],
  },
  {
    code: '46',
    birth: '2025-03-01',
    lot: 'CEBA_B',
    weights: [
      ['2026-07-15', 300],
      ['2026-09-14', 312],
    ],
  },
  {
    code: '47',
    birth: '2025-04-01',
    lot: 'CEBA_B',
    weights: [
      ['2026-07-15', 280],
      ['2026-09-14', 290],
    ],
  },
  {
    code: '48',
    birth: '2021-05-01',
    lot: null,
    breeder: true,
    weights: [
      ['2026-07-15', 600],
      ['2026-09-14', 610],
    ],
  },
];

export type CebaAnimal = {
  readonly id: string;
  readonly code: string;
  readonly sex: Sex;
  readonly birthDate: IsoDate;
  readonly lotId: string | null;
  readonly breeder: boolean;
  readonly visualTagId: string;
  readonly weights: readonly { readonly id: string; readonly on: IsoDate; readonly kg: number }[];
};

export type RetiroCeba = {
  readonly lots: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }[];
  readonly breederTag: { readonly id: string; readonly key: string; readonly label: string };
  readonly animals: readonly CebaAnimal[];
  /** Vínculos de la etiqueta «Reproductor». */
  readonly breederLinks: readonly { readonly id: string; readonly animalId: string }[];
};

/** Construye los casos en memoria. */
export function buildRetiroCeba(): RetiroCeba {
  const ids = createIdFactory(createRandom(CEBA_SEED), ID_EPOCH_OFFSET_MS);
  const lotIds = new Map<CebaLotKey, string>();
  const lots = CEBA_LOTS.map((lot) => {
    const id = ids.next();
    lotIds.set(lot.key, id);
    return { id, name: lot.name, description: lot.description };
  });
  const breederTag = { id: ids.next(), key: BREEDER_TAG_KEY, label: 'Reproductor' };
  const animals = SPECS.map((spec): CebaAnimal => ({
    id: ids.next(),
    code: spec.code,
    sex: SEX.MALE,
    birthDate: toIsoDate(spec.birth),
    lotId: spec.lot === null ? null : (lotIds.get(spec.lot) ?? null),
    breeder: spec.breeder === true,
    visualTagId: ids.next(),
    weights: spec.weights.map(([on, kg]) => ({ id: ids.next(), on: toIsoDate(on), kg })),
  }));
  const breederLinks = animals
    .filter((animal) => animal.breeder)
    .map((animal) => ({ id: ids.next(), animalId: animal.id }));
  return { lots, breederTag, animals, breederLinks };
}
