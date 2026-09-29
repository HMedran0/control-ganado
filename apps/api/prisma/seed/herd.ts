/**
 * Construcción del hato de la finca de referencia (08 §3.2) a partir de la receta de
 * `plan.ts`.
 *
 * El orden importa, porque cada paso depende del anterior:
 *
 * 1. se arma el **calendario de partos**, que es lo que fija la edad de las crías y, con
 *    ella, las categorías y las alertas;
 * 2. se reparten esos partos entre las vacas respetando el intervalo mínimo entre uno y otro;
 * 3. la fecha de nacimiento de cada vaca se deduce de su primer parto, nunca al revés, para
 *    que ninguna cría nazca antes de que su madre tuviera edad reproductiva (RN-23);
 * 4. las preñeces se calculan con `expectedCalvingDate`, con los días de gestación de la
 *    raza de la madre (RN-04).
 *
 * Nada derivado se guarda: ni categoría, ni etiquetas, ni número de partos (RN-16).
 */

import {
  addDays,
  addMonths,
  CALVING_TYPE,
  compareIsoDates,
  daysBetween,
  EXIT_TYPE,
  expectedCalvingDate,
  formatCalfCode,
  isoDateParts,
  maxIsoDate,
  minIsoDate,
  ORIGIN,
  PREGNANCY_OUTCOME,
  SERVICE_METHOD,
  SEX,
  toIsoDate,
  type CalvingType,
  type ExitType,
  type IsoDate,
  type Origin,
  type PregnancyOutcome,
  type ServiceMethod,
  type Sex,
} from '@hato/shared';

import { HERD_BREED_MIX, type Catalog, type LotKey } from './catalog.js';
import type { IdFactory } from './ids.js';
import {
  ACTIVE,
  CALF_SEX_SPLIT,
  CALVING_2026,
  CALVINGS_DUE_SOON,
  CALVINGS_OVERDUE,
  COW_CALVING_PATTERNS,
  COW_STATE,
  EARLIER_CALVINGS,
  FOR_SALE_YOUNG_MALES,
  HEIFER_STATE,
  HISTORY_DESTINY,
  MIN_CALVING_INTERVAL_DAYS,
  NATURAL_SERVICE_SHARE,
  TWIN_CALVINGS,
  YOUNG_MALE_EARLIEST_BIRTH,
  type DateWindow,
} from './plan.js';
import { distribute, type SeededRandom } from './random.js';

/** Primer día del historial sembrado: antes de esta fecha, las preñeces son importadas. */
const HISTORY_START = toIsoDate('2024-01-01');

/** Partos próximos que aporta cada grupo; suman `CALVINGS_DUE_SOON`. */
const DUE_SOON_HEIFERS = 4;
const DUE_SOON_COWS = CALVINGS_DUE_SOON - DUE_SOON_HEIFERS;

/** Animal listo para escribir, con lo que los demás módulos del seed necesitan consultar. */
export type SeedAnimal = {
  readonly id: string;
  code: string;
  readonly name: string | null;
  readonly sex: Sex;
  readonly breedName: string;
  readonly birthDate: IsoDate;
  readonly birthDateEstimated: boolean;
  readonly origin: Origin;
  readonly originDetail: string | null;
  readonly entryDate: IsoDate;
  readonly damId: string | null;
  readonly sireId: string | null;
  readonly sireExternalRef: string | null;
  readonly birthPregnancyId: string | null;
  lotKey: LotKey;
  forSale: boolean;
  exitType: ExitType | null;
  exitDate: IsoDate | null;
  exitReason: string | null;
  readonly notes: string | null;
  readonly tagKeys: readonly string[];
};

/** Preñez lista para escribir. */
export type SeedPregnancy = {
  readonly id: string;
  readonly damId: string;
  readonly serviceDate: IsoDate;
  readonly serviceDateEstimated: boolean;
  readonly method: ServiceMethod;
  readonly sireId: string | null;
  readonly sireExternalRef: string | null;
  readonly confirmedAt: IsoDate | null;
  readonly expectedCalvingDate: IsoDate;
  readonly outcome: PregnancyOutcome;
  readonly outcomeDate: IsoDate | null;
  readonly calvingType: CalvingType | null;
  readonly stillbornCount: number;
  readonly isImported: boolean;
  readonly responsible: string | null;
  readonly notes: string | null;
};

/** Hato completo en memoria, antes de escribirlo. */
export type Herd = {
  readonly animals: readonly SeedAnimal[];
  readonly pregnancies: readonly SeedPregnancy[];
  /** Los cuatro toros, en orden de entrada a la finca. */
  readonly bulls: readonly SeedAnimal[];
  readonly byId: ReadonlyMap<string, SeedAnimal>;
};

/** Reparte `count` fechas a lo largo de la ventana, de forma determinista y sin repetir. */
function spreadDates(count: number, range: DateWindow, random: SeededRandom): IsoDate[] {
  if (count === 0) return [];
  const span = daysBetween(range.from, range.to);
  if (span < 0) throw new Error(`Ventana inválida: ${range.from}..${range.to}.`);
  if (count > span + 1) {
    throw new Error(`No caben ${count} fechas distintas entre ${range.from} y ${range.to}.`);
  }

  const used = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const base = count === 1 ? Math.floor(span / 2) : Math.round((span * index) / (count - 1));
    let offset = Math.min(span, Math.max(0, base + random.int(-2, 2)));
    while (used.has(offset)) offset = offset >= span ? offset - 1 : offset + 1;
    used.add(offset);
  }
  return [...used].sort((a, b) => a - b).map((offset) => addDays(range.from, offset));
}

/** Estado reproductivo de una hembra en el hato sembrado. */
type FemaleState = 'PREGNANT' | 'SERVED' | 'DRY' | 'OPEN';

/** En qué se convirtió una cría del historial. */
type CalfDestiny = 'CALF' | 'YOUNG_MALE' | 'HEIFER' | 'SOLD_MALE' | 'DEAD_MALE' | 'DEAD_FEMALE';

/** Un parto por colocar. */
type CalvingSlot = {
  readonly date: IsoDate;
  readonly liveCalves: number;
  readonly stillborn: number;
  readonly destinies: readonly CalfDestiny[];
  readonly sexes: readonly Sex[];
};

/** Plan de partos de una vaca antes de generar las filas. */
type CowPlan = {
  readonly animalId: string;
  recentCalving: IsoDate | null;
  recentIsStillbirth: boolean;
  /** Partos desde 2024 anteriores al reciente, del más nuevo al más viejo. */
  earlierCalvings: IsoDate[];
  /** Partos anteriores a 2024: preñeces importadas sin crías (RN-29). */
  importedCalvings: IsoDate[];
  slots: CalvingSlot[];
  state: FemaleState;
  servedLongAgo: boolean;
  dueSoon: boolean;
  readonly breedName: string;
  birthDate: IsoDate;
  exit: { readonly type: ExitType; readonly date: IsoDate; readonly reason: string } | null;
};

function repeat<T>(value: T, times: number): T[] {
  return Array.from({ length: times }, () => value);
}

function sexSequence(males: number, females: number, random: SeededRandom): Sex[] {
  return random.shuffle([...repeat(SEX.MALE, males), ...repeat(SEX.FEMALE, females)]);
}

/** Partos de 2026 cuyas crías siguen al pie, más los dos partos con mortinato. */
function buildRecentCalvings(random: SeededRandom): CalvingSlot[] {
  const slots: CalvingSlot[] = [];

  const earlyDates = spreadDates(CALVING_2026.early.calvings, CALVING_2026.early.window, random);
  const earlySexes = sexSequence(CALF_SEX_SPLIT.early.males, CALF_SEX_SPLIT.early.females, random);
  const twinPositions = new Set(
    random.shuffle(earlyDates.map((_, index) => index)).slice(0, TWIN_CALVINGS),
  );

  let cursor = 0;
  for (const [index, date] of earlyDates.entries()) {
    const liveCalves = twinPositions.has(index) ? 2 : 1;
    const sexes = earlySexes.slice(cursor, cursor + liveCalves);
    cursor += liveCalves;
    slots.push({
      date,
      liveCalves,
      stillborn: 0,
      destinies: repeat<CalfDestiny>('CALF', liveCalves),
      sexes,
    });
  }

  for (const key of ['served', 'recent'] as const) {
    const group = CALVING_2026[key];
    const dates = spreadDates(group.calvings, group.window, random);
    const sexes = sexSequence(CALF_SEX_SPLIT[key].males, CALF_SEX_SPLIT[key].females, random);
    for (const [index, date] of dates.entries()) {
      const sex = sexes[index];
      if (sex === undefined) throw new Error('Faltó un sexo en el calendario de partos.');
      slots.push({ date, liveCalves: 1, stillborn: 0, destinies: ['CALF'], sexes: [sex] });
    }
  }

  for (const date of spreadDates(
    CALVING_2026.stillborn.calvings,
    CALVING_2026.stillborn.window,
    random,
  )) {
    slots.push({ date, liveCalves: 0, stillborn: 1, destinies: [], sexes: [] });
  }

  return slots.sort((a, b) => compareIsoDates(a.date, b.date));
}

/**
 * Partos anteriores al 26 de febrero de 2026 y destino de cada cría.
 *
 * La restricción que manda: un macho nacido antes del 5 de octubre de 2024 tendría hoy 24
 * meses o más y sería macho adulto, no levante (RN-06). Los partos anteriores a esa fecha
 * solo pueden dar hembras o machos que ya salieron del hato.
 */
function buildEarlierCalvings(random: SeededRandom): CalvingSlot[] {
  const quota: Record<Exclude<CalfDestiny, 'CALF'>, number> = {
    SOLD_MALE: HISTORY_DESTINY.soldMales,
    DEAD_FEMALE: HISTORY_DESTINY.deadFemale,
    HEIFER: HISTORY_DESTINY.heifers,
    YOUNG_MALE: HISTORY_DESTINY.youngMales,
    DEAD_MALE: HISTORY_DESTINY.deadMale,
  };

  const historySlots = spreadDates(
    EARLIER_CALVINGS.history.calvings,
    EARLIER_CALVINGS.history.window,
    random,
  ).map((date): CalvingSlot => {
    const tooOldForYoungMale = compareIsoDates(date, YOUNG_MALE_EARLIEST_BIRTH) < 0;
    const options: Exclude<CalfDestiny, 'CALF'>[] = tooOldForYoungMale
      ? ['SOLD_MALE', 'HEIFER', 'DEAD_FEMALE']
      : ['YOUNG_MALE', 'HEIFER', 'DEAD_MALE'];

    const destiny =
      options.find((option) => quota[option] > 0) ??
      (Object.keys(quota) as Exclude<CalfDestiny, 'CALF'>[]).find((key) => quota[key] > 0);
    if (destiny === undefined) throw new Error('Se agotaron los destinos de las crías.');
    quota[destiny] -= 1;

    const sex: Sex = destiny === 'HEIFER' || destiny === 'DEAD_FEMALE' ? SEX.FEMALE : SEX.MALE;
    return { date, liveCalves: 1, stillborn: 0, destinies: [destiny], sexes: [sex] };
  });

  const januarySexes = sexSequence(
    EARLIER_CALVINGS.january.males,
    EARLIER_CALVINGS.january.females,
    random,
  );
  const januarySlots = spreadDates(
    EARLIER_CALVINGS.january.calvings,
    EARLIER_CALVINGS.january.window,
    random,
  ).map((date, index): CalvingSlot => {
    const sex = januarySexes[index];
    if (sex === undefined) throw new Error('Faltó un sexo en los partos de enero.');
    return {
      date,
      liveCalves: 1,
      stillborn: 0,
      destinies: [sex === SEX.MALE ? 'YOUNG_MALE' : 'HEIFER'],
      sexes: [sex],
    };
  });

  return [...historySlots, ...januarySlots].sort((a, b) => compareIsoDates(a.date, b.date));
}

/**
 * Reparte los partos entre las vacas.
 *
 * Los huecos del historial se atienden por fecha límite ascendente y se les da la fecha libre
 * más antigua que les sirva: es lo que garantiza que todos quepan. Las vacas con dos partos
 * anteriores reciben los dos a la vez, para poder exigir el intervalo mínimo entre ellos.
 */
function assignDams(
  cows: readonly CowPlan[],
  recent: readonly CalvingSlot[],
  earlier: readonly CalvingSlot[],
  random: SeededRandom,
): void {
  const order = random.shuffle(cows);
  const withRecent = order.slice(0, recent.length);
  const withoutRecent = order.slice(recent.length);

  // 1. Un parto de 2026 por vaca; los dos con mortinato van primero, a vacas distintas.
  const ordered = [
    ...recent.filter((slot) => slot.stillborn > 0),
    ...recent.filter((slot) => slot.stillborn === 0),
  ];
  for (const [index, slot] of ordered.entries()) {
    const cow = withRecent[index];
    if (cow === undefined) throw new Error('Faltan vacas para los partos de 2026.');
    cow.recentCalving = slot.date;
    cow.recentIsStillbirth = slot.stillborn > 0;
    cow.slots.push(slot);
  }

  // 2. Los partos de enero y febrero de 2026 son el parto más reciente de vacas sin cría al
  //    pie: entre ese parto y hoy ya pasaron los siete meses del destete.
  const januaryFrom = EARLIER_CALVINGS.january.window.from;
  const januarySlots = earlier.filter((slot) => compareIsoDates(slot.date, januaryFrom) >= 0);
  const historySlots = earlier.filter((slot) => compareIsoDates(slot.date, januaryFrom) < 0);

  for (const [index, slot] of januarySlots.entries()) {
    const cow = withoutRecent[index];
    if (cow === undefined) throw new Error('Faltan vacas para los partos de enero.');
    cow.earlierCalvings.push(slot.date);
    cow.slots.push(slot);
  }

  // 3. El resto del historial.
  type Request = { readonly cow: CowPlan; readonly count: number; readonly deadline: IsoDate };
  const requests: Request[] = [];
  const patterns = [
    { cows: COW_CALVING_PATTERNS.recentPlusTwo, extra: 2 },
    { cows: COW_CALVING_PATTERNS.recentPlusOne, extra: 1 },
    { cows: COW_CALVING_PATTERNS.recentOnly, extra: 0 },
  ];

  // El patrón de partos se sortea aparte de la fecha del parto de 2026. Si se repartiera en
  // el orden en que se asignaron los partos, todas las vacas con un parto anterior serían
  // las que parieron temprano, y sus fechas límite se amontonarían en el mismo tramo del
  // historial.
  const byPattern = random.shuffle(withRecent);
  let cursor = 0;
  for (const pattern of patterns) {
    for (let taken = 0; taken < pattern.cows; taken += 1) {
      const cow = byPattern[cursor];
      cursor += 1;
      if (cow === undefined) throw new Error('Desajuste en los patrones de parto.');
      if (pattern.extra === 0) continue;
      const anchor = cow.recentCalving;
      if (anchor === null) throw new Error('Una vaca con parto reciente se quedó sin fecha.');
      requests.push({
        cow,
        count: pattern.extra,
        deadline: addDays(anchor, -MIN_CALVING_INTERVAL_DAYS * pattern.extra),
      });
    }
  }

  const pending = historySlots.length - requests.reduce((sum, item) => sum + item.count, 0);
  for (const cow of withoutRecent.slice(januarySlots.length, januarySlots.length + pending)) {
    requests.push({ cow, count: 1, deadline: EARLIER_CALVINGS.history.window.to });
  }

  const requested = requests.reduce((sum, item) => sum + item.count, 0);
  if (requested !== historySlots.length) {
    throw new Error(
      `Los huecos de parto (${requested}) no coinciden con el historial (${historySlots.length}).`,
    );
  }

  requests.sort((a, b) => compareIsoDates(a.deadline, b.deadline));
  const available = [...historySlots].sort((a, b) => compareIsoDates(a.date, b.date));

  for (const request of requests) {
    let floor: IsoDate | null = null;
    // Del parto más viejo al más nuevo: cada uno, al menos el intervalo mínimo después.
    for (let step = 0; step < request.count; step += 1) {
      // `deadline` es el límite del parto más viejo; cada parto posterior gana un intervalo.
      const limit = addDays(request.deadline, MIN_CALVING_INTERVAL_DAYS * step);
      const index = available.findIndex(
        (slot) =>
          compareIsoDates(slot.date, limit) <= 0 &&
          (floor === null || compareIsoDates(slot.date, floor) >= 0),
      );
      if (index === -1) {
        throw new Error(
          `No queda ningún parto del historial antes de ${limit} para una de las vacas.`,
        );
      }
      const [slot] = available.splice(index, 1);
      if (slot === undefined) throw new Error('Parto del historial indefinido.');
      request.cow.earlierCalvings.push(slot.date);
      request.cow.slots.push(slot);
      floor = addDays(slot.date, MIN_CALVING_INTERVAL_DAYS);
    }
  }

  for (const cow of cows) {
    cow.earlierCalvings.sort((a, b) => compareIsoDates(b, a));
    cow.slots.sort((a, b) => compareIsoDates(a.date, b.date));
  }
}

/** Reparte los estados reproductivos entre las 118 vacas activas (08 §3.2). */
function assignCowStates(cows: readonly CowPlan[], random: SeededRandom): void {
  const live = cows
    .filter((cow) => cow.recentCalving !== null && !cow.recentIsStillbirth)
    .sort((a, b) =>
      compareIsoDates(a.recentCalving ?? HISTORY_START, b.recentCalving ?? HISTORY_START),
    );
  const stillbirth = cows.filter((cow) => cow.recentIsStillbirth);
  const withoutRecent = cows.filter((cow) => cow.recentCalving === null);

  // Las que parieron y ya volvieron a servirse: preñada si dio tiempo de palpar, servida si
  // el parto fue hace poco, sin servir si fue hace muy poco.
  live.forEach((cow, index) => {
    if (index < CALVING_2026.early.calvings) cow.state = 'PREGNANT';
    else if (index < CALVING_2026.early.calvings + CALVING_2026.served.calvings) {
      cow.state = 'SERVED';
    } else cow.state = 'OPEN';
  });

  // Las madres de los mortinatos volvieron a servirse y hoy están preñadas.
  for (const cow of stillbirth) cow.state = 'PREGNANT';

  const pregnant = COW_STATE.pregnant - CALVING_2026.early.calvings - stillbirth.length;
  const served = COW_STATE.served - CALVING_2026.served.calvings;
  random.shuffle(withoutRecent).forEach((cow, index) => {
    if (index < pregnant) {
      cow.state = 'PREGNANT';
      cow.dueSoon = index < DUE_SOON_COWS;
    } else if (index < pregnant + served) {
      cow.state = 'SERVED';
      cow.servedLongAgo = true;
    } else {
      cow.state = 'DRY';
    }
  });
}

/** Construye el hato completo. */
export function buildHerd(
  catalog: Catalog,
  random: SeededRandom,
  ids: IdFactory,
  today: IsoDate,
): Herd {
  const animals: SeedAnimal[] = [];
  const pregnancies: SeedPregnancy[] = [];

  const gestationOf = (breedName: string): number => {
    const days = catalog.breedGestationDays.get(breedName);
    if (days === undefined) throw new Error(`Raza desconocida: ${breedName}.`);
    return days;
  };

  // --- Machos comprados: cuatro toros y dos bueyes coteros (08 §3.2) ---
  const bulls: SeedAnimal[] = [];
  const purchased = (spec: {
    breed: string;
    birth: string;
    entry: string;
    name: string;
    detail: string;
    notes: string;
    estimated: boolean;
    tagKeys: readonly string[];
  }): SeedAnimal => ({
    id: ids.next(),
    code: '',
    name: spec.name,
    sex: SEX.MALE,
    breedName: spec.breed,
    birthDate: toIsoDate(spec.birth),
    birthDateEstimated: spec.estimated,
    origin: ORIGIN.PURCHASED,
    originDetail: spec.detail,
    entryDate: toIsoDate(spec.entry),
    damId: null,
    sireId: null,
    sireExternalRef: null,
    birthPregnancyId: null,
    lotKey: 'TOROS',
    forSale: false,
    exitType: null,
    exitDate: null,
    exitReason: null,
    notes: spec.notes,
    tagKeys: spec.tagKeys,
  });

  for (const spec of [
    { breed: 'Brahman', birth: '2019-04-18', entry: '2021-05-12', name: 'Faraón' },
    { breed: 'Brahman', birth: '2020-02-09', entry: '2022-03-04', name: 'Sultán' },
    { breed: 'Gyr', birth: '2020-11-23', entry: '2022-11-15', name: 'Manantial' },
    { breed: 'Romosinuano', birth: '2021-06-30', entry: '2023-01-20', name: 'Romo' },
  ]) {
    const bull = purchased({
      ...spec,
      detail: 'Feria ganadera de Sincelejo',
      notes: 'Reproductor de la finca.',
      estimated: false,
      tagKeys: [],
    });
    bulls.push(bull);
    animals.push(bull);
  }

  for (const spec of [
    { breed: 'Brahman × Pardo', birth: '2018-08-14', entry: '2020-09-02', name: 'Lucero' },
    { breed: 'Cruce', birth: '2019-01-27', entry: '2021-02-18', name: 'Palomo' },
  ]) {
    animals.push(
      purchased({
        ...spec,
        detail: 'Compra a finca vecina',
        notes: 'Buey de trabajo.',
        estimated: true,
        tagKeys: ['COTERO'],
      }),
    );
  }

  // --- Vacas: 118 activas, 2 vendidas y 1 muerta ---
  const totalCows = ACTIVE.cows + 3;
  const breedNames = HERD_BREED_MIX.map((entry) => entry.name);
  const breedPool = random.shuffle(
    distribute(
      totalCows,
      HERD_BREED_MIX.map((entry) => entry.share),
    ).flatMap((count, index) => repeat(breedNames[index] ?? 'Brahman', count)),
  );

  const cowPlans: CowPlan[] = Array.from({ length: totalCows }, (_, index) => ({
    animalId: ids.next(),
    recentCalving: null,
    recentIsStillbirth: false,
    earlierCalvings: [],
    importedCalvings: [],
    slots: [],
    state: 'OPEN',
    servedLongAgo: false,
    dueSoon: false,
    breedName: breedPool[index] ?? 'Brahman',
    birthDate: toIsoDate('2020-01-01'),
    exit: null,
  }));

  const activeCows = cowPlans.slice(0, ACTIVE.cows);
  const exitedCows = cowPlans.slice(ACTIVE.cows);

  assignDams(activeCows, buildRecentCalvings(random), buildEarlierCalvings(random), random);
  assignCowStates(activeCows, random);

  // Las vacas que salieron del hato solo tienen historia anterior a 2024.
  for (const [index, cow] of exitedCows.entries()) {
    const spec = [
      { type: EXIT_TYPE.SALE, date: '2026-02-14', reason: 'Venta por descarte: vaca vieja' },
      { type: EXIT_TYPE.SALE, date: '2026-06-05', reason: 'Venta por descarte: baja fertilidad' },
      { type: EXIT_TYPE.DEATH, date: '2026-04-12', reason: 'Muerte por complicación de parto' },
    ][index];
    if (spec === undefined) throw new Error('Faltan salidas para las vacas retiradas.');
    cow.exit = { type: spec.type, date: toIsoDate(spec.date), reason: spec.reason };
    cow.state = 'OPEN';
  }

  // --- Partos históricos y fecha de nacimiento de cada vaca ---
  for (const cow of cowPlans) {
    const known = [
      ...(cow.recentCalving === null ? [] : [cow.recentCalving]),
      ...cow.earlierCalvings,
    ];
    const oldestKnown = known.length === 0 ? null : minIsoDate(known[0] ?? HISTORY_START, ...known);

    // La paridez total de cada vaca queda entre 1 y 7 partos (08 §3.2).
    const importedCount = Math.max(
      known.length === 0 ? 1 : 0,
      random.int(0, Math.min(4, 7 - known.length)),
    );
    let cursor = minIsoDate(oldestKnown ?? HISTORY_START, HISTORY_START);
    for (let index = 0; index < importedCount; index += 1) {
      cursor = addDays(cursor, -random.int(MIN_CALVING_INTERVAL_DAYS, 430));
      cow.importedCalvings.push(cursor);
    }

    const firstCalving = cow.importedCalvings.at(-1) ?? oldestKnown ?? HISTORY_START;
    cow.birthDate = addMonths(firstCalving, -random.int(27, 40));
  }

  for (const cow of cowPlans) {
    animals.push({
      id: cow.animalId,
      code: '',
      name: null,
      sex: SEX.FEMALE,
      breedName: cow.breedName,
      birthDate: cow.birthDate,
      birthDateEstimated: true,
      origin: ORIGIN.BORN_ON_FARM,
      originDetail: null,
      entryDate: cow.birthDate,
      damId: null,
      sireId: null,
      sireExternalRef: null,
      birthPregnancyId: null,
      lotKey:
        cow.exit === null && cow.recentCalving !== null && !cow.recentIsStillbirth
          ? 'PARIDAS'
          : 'HORRAS',
      forSale: false,
      exitType: cow.exit?.type ?? null,
      exitDate: cow.exit?.date ?? null,
      exitReason: cow.exit?.reason ?? null,
      notes: null,
      tagKeys: [],
    });
  }

  // --- Preñeces con parto y sus crías ---
  const pickSire = (serviceDate: IsoDate) => {
    if (!random.chance(NATURAL_SERVICE_SHARE)) {
      return {
        sireId: null,
        sireExternalRef: `PAJILLA-${random.pick(['GIR', 'BRA', 'PAR'])}-${
          isoDateParts(serviceDate).year
        }-${String(random.int(1, 40)).padStart(3, '0')}`,
        method: SERVICE_METHOD.AI as ServiceMethod,
      };
    }
    const available = bulls.filter((bull) => compareIsoDates(bull.entryDate, serviceDate) <= 0);
    const bull = available.length === 0 ? bulls[0] : random.pick(available);
    if (bull === undefined) throw new Error('No hay toros disponibles.');
    return {
      sireId: bull.id,
      sireExternalRef: null,
      method: SERVICE_METHOD.NATURAL as ServiceMethod,
    };
  };

  const byDestiny = new Map<CalfDestiny, SeedAnimal[]>();

  for (const cow of cowPlans) {
    for (const slot of cow.slots) {
      const gestation = gestationOf(cow.breedName);
      const serviceDate = addDays(slot.date, -gestation);
      const sire = pickSire(serviceDate);
      const pregnancyId = ids.next();

      pregnancies.push({
        id: pregnancyId,
        damId: cow.animalId,
        serviceDate,
        serviceDateEstimated: false,
        method: sire.method,
        sireId: sire.sireId,
        sireExternalRef: sire.sireExternalRef,
        confirmedAt: addDays(serviceDate, random.int(45, 75)),
        expectedCalvingDate: expectedCalvingDate({
          serviceDate,
          breedGestationDays: gestation,
          farmGestationDays: catalog.settings.gestationDays,
        }),
        outcome: PREGNANCY_OUTCOME.CALVED,
        outcomeDate: slot.date,
        calvingType: slot.liveCalves > 1 ? CALVING_TYPE.ASSISTED : CALVING_TYPE.NORMAL,
        stillbornCount: slot.stillborn,
        isImported: false,
        responsible: slot.liveCalves > 1 ? 'Dra. Paola Barrios' : 'Wilmer Ortega',
        notes: slot.stillborn > 0 ? 'Cría muerta al nacer.' : null,
      });

      for (let index = 0; index < slot.liveCalves; index += 1) {
        const sex = slot.sexes[index];
        const destiny = slot.destinies[index];
        if (sex === undefined || destiny === undefined) {
          throw new Error('Parto sin sexo o destino para la cría.');
        }
        const calf: SeedAnimal = {
          id: ids.next(),
          code: '',
          name: null,
          sex,
          breedName: cow.breedName,
          birthDate: slot.date,
          birthDateEstimated: false,
          origin: ORIGIN.BORN_ON_FARM,
          originDetail: null,
          entryDate: slot.date,
          damId: cow.animalId,
          sireId: sire.sireId,
          sireExternalRef: sire.sireExternalRef,
          birthPregnancyId: pregnancyId,
          lotKey: 'PARIDAS',
          forSale: false,
          exitType: null,
          exitDate: null,
          exitReason: null,
          notes: null,
          tagKeys: [],
        };
        animals.push(calf);
        byDestiny.set(destiny, [...(byDestiny.get(destiny) ?? []), calf]);
      }
    }

    for (const date of cow.importedCalvings) {
      const gestation = gestationOf(cow.breedName);
      const serviceDate = addDays(date, -gestation);
      pregnancies.push({
        id: ids.next(),
        damId: cow.animalId,
        serviceDate,
        serviceDateEstimated: true,
        method: SERVICE_METHOD.UNKNOWN,
        sireId: null,
        sireExternalRef: null,
        confirmedAt: null,
        expectedCalvingDate: expectedCalvingDate({
          serviceDate,
          breedGestationDays: gestation,
          farmGestationDays: catalog.settings.gestationDays,
        }),
        outcome: PREGNANCY_OUTCOME.CALVED,
        outcomeDate: date,
        calvingType: null,
        stillbornCount: 0,
        isImported: true,
        responsible: null,
        notes: 'Parto anterior al historial sembrado, tomado del cuaderno de la finca.',
      });
    }
  }

  applyDestinies(byDestiny, random, today);

  addOpenPregnancies({
    cows: activeCows,
    heifers: byDestiny.get('HEIFER') ?? [],
    pregnancies,
    catalog,
    random,
    ids,
    today,
    pickSire,
    gestationOf,
  });

  assignCodes(animals);

  return { animals, pregnancies, bulls, byId: new Map(animals.map((a) => [a.id, a])) };
}

/** Lote, disponibilidad y salidas de las crías del historial. */
function applyDestinies(
  byDestiny: ReadonlyMap<CalfDestiny, SeedAnimal[]>,
  random: SeededRandom,
  today: IsoDate,
): void {
  const youngMales = byDestiny.get('YOUNG_MALE') ?? [];
  for (const animal of youngMales) animal.lotKey = 'LEVANTE';
  for (const animal of random.shuffle(youngMales).slice(0, FOR_SALE_YOUNG_MALES)) {
    animal.forSale = true;
  }

  for (const animal of byDestiny.get('HEIFER') ?? []) animal.lotKey = 'HORRAS';

  const exits = [
    {
      destiny: 'SOLD_MALE' as const,
      type: EXIT_TYPE.SALE,
      reason: 'Venta de levante en pie',
      ageDays: [540, 780] as const,
    },
    {
      destiny: 'DEAD_MALE' as const,
      type: EXIT_TYPE.DEATH,
      reason: 'Muerte por accidente en potrero',
      ageDays: [240, 400] as const,
    },
    {
      destiny: 'DEAD_FEMALE' as const,
      type: EXIT_TYPE.DEATH,
      reason: 'Muerte por enfermedad',
      ageDays: [200, 380] as const,
    },
  ];

  for (const exit of exits) {
    for (const animal of byDestiny.get(exit.destiny) ?? []) {
      animal.lotKey = 'LEVANTE';
      animal.forSale = false;
      animal.exitType = exit.type;
      animal.exitDate = minIsoDate(
        addDays(animal.birthDate, random.int(exit.ageDays[0], exit.ageDays[1])),
        addDays(today, -5),
      );
      animal.exitReason = exit.reason;
    }
  }
}

/** Argumentos de `addOpenPregnancies`. */
type OpenPregnancyInput = {
  readonly cows: readonly CowPlan[];
  readonly heifers: readonly SeedAnimal[];
  readonly pregnancies: SeedPregnancy[];
  readonly catalog: Catalog;
  readonly random: SeededRandom;
  readonly ids: IdFactory;
  readonly today: IsoDate;
  readonly pickSire: (serviceDate: IsoDate) => {
    sireId: string | null;
    sireExternalRef: string | null;
    method: ServiceMethod;
  };
  readonly gestationOf: (breedName: string) => number;
};

/** Crea las preñeces abiertas de vacas y novillas (RN-03: una sola abierta por hembra). */
function addOpenPregnancies(input: OpenPregnancyInput): void {
  const { cows, heifers, pregnancies, catalog, random, ids, today, pickSire, gestationOf } = input;
  let overdueLeft = CALVINGS_OVERDUE;

  const open = (
    damId: string,
    breedName: string,
    serviceDate: IsoDate,
    confirmed: boolean,
  ): void => {
    const gestation = gestationOf(breedName);
    const sire = pickSire(serviceDate);
    pregnancies.push({
      id: ids.next(),
      damId,
      serviceDate,
      serviceDateEstimated: false,
      method: sire.method,
      sireId: sire.sireId,
      sireExternalRef: sire.sireExternalRef,
      // La palpación nunca es futura ni anterior a los 30 días del servicio.
      confirmedAt: confirmed
        ? maxIsoDate(
            addDays(serviceDate, 30),
            minIsoDate(addDays(serviceDate, random.int(45, 70)), addDays(today, -2)),
          )
        : null,
      expectedCalvingDate: expectedCalvingDate({
        serviceDate,
        breedGestationDays: gestation,
        farmGestationDays: catalog.settings.gestationDays,
      }),
      outcome: PREGNANCY_OUTCOME.PENDING,
      outcomeDate: null,
      calvingType: null,
      stillbornCount: 0,
      isImported: false,
      responsible: confirmed ? 'Dra. Paola Barrios' : null,
      notes: null,
    });
  };

  for (const cow of cows) {
    if (cow.state !== 'PREGNANT' && cow.state !== 'SERVED') continue;
    const lastCalving = cow.recentCalving ?? cow.earlierCalvings[0] ?? null;
    const gestation = gestationOf(cow.breedName);

    let serviceDate: IsoDate;
    if (cow.dueSoon) {
      // Se calcula hacia atrás desde la fecha de parto deseada, para que el tablero muestre
      // exactamente los partos próximos previstos.
      const offset = random.int(4, 29);
      serviceDate = addDays(addDays(today, offset), -gestation);
      // Las primeras que lo permiten quedan con el parto vencido hace 16 a 41 días (M5), con el
      // mismo número aleatorio para no mover el resto de la secuencia. Solo si el servicio sigue
      // siendo posterior al último parto más 55 días.
      const overdueService = addDays(addDays(today, -(offset + 12)), -gestation);
      if (
        overdueLeft > 0 &&
        (lastCalving === null || compareIsoDates(addDays(lastCalving, 55), overdueService) <= 0)
      ) {
        serviceDate = overdueService;
        overdueLeft -= 1;
      }
    } else if (cow.servedLongAgo) {
      serviceDate = addDays(today, -random.int(95, 135));
    } else if (cow.state === 'SERVED') {
      serviceDate = addDays(lastCalving ?? addDays(today, -120), random.int(55, 70));
    } else {
      const earliest = lastCalving === null ? addDays(today, -240) : addDays(lastCalving, 55);
      const latest = addDays(today, -50);
      serviceDate =
        compareIsoDates(earliest, latest) >= 0 ? latest : randomBetween(earliest, latest, random);
    }

    serviceDate = minIsoDate(serviceDate, addDays(today, -1));
    if (!cow.dueSoon) {
      // Las que no están en la lista de partos próximos tienen que parir después de la
      // ventana de alerta, o el tablero mostraría más de las previstas.
      serviceDate = maxIsoDate(
        serviceDate,
        addDays(today, catalog.settings.calvingAlertDays + 1 - gestation),
      );
    }
    open(cow.animalId, cow.breedName, serviceDate, cow.state === 'PREGNANT');
  }

  if (overdueLeft > 0) {
    throw new Error(`No hubo vacas para los ${CALVINGS_OVERDUE} partos vencidos del seed.`);
  }

  // Novillas: las 12 de mayor edad son las servidas y 7 de ellas están confirmadas (08 §3.2).
  const oldestFirst = [...heifers].sort((a, b) => compareIsoDates(a.birthDate, b.birthDate));
  oldestFirst.slice(0, HEIFER_STATE.pregnant + HEIFER_STATE.served).forEach((heifer, index) => {
    const confirmed = index < HEIFER_STATE.pregnant;
    const gestation = gestationOf(heifer.breedName);
    // Servicio reciente para las servidas sin palpar (menos de 90 días) y más viejo para las
    // confirmadas, que ya tuvieron tiempo de palparse y paren más adelante.
    const serviceDate =
      confirmed && index < DUE_SOON_HEIFERS
        ? addDays(addDays(today, random.int(3, 28)), -gestation)
        : addDays(today, -random.int(confirmed ? 60 : 20, confirmed ? 200 : 70));
    open(heifer.id, heifer.breedName, serviceDate, confirmed);
  });
}

function randomBetween(from: IsoDate, to: IsoDate, random: SeededRandom): IsoDate {
  return addDays(from, random.int(0, Math.max(0, daysBetween(from, to))));
}

/**
 * Códigos internos (08 §2.3): los animales que ya existían conservan su número de tres
 * dígitos y los nacidos en 2026 estrenan el patrón `{YY}-{NNN}`, armado con `formatCalfCode`.
 */
function assignCodes(animals: readonly SeedAnimal[]): void {
  const byBirth = [...animals].sort(
    (a, b) => compareIsoDates(a.birthDate, b.birthDate) || a.id.localeCompare(b.id),
  );

  let legacy = 0;
  let calves = 0;
  for (const animal of byBirth) {
    const year = isoDateParts(animal.birthDate).year;
    if (year >= 2026) {
      calves += 1;
      animal.code = formatCalfCode('{YY}-{NNN}', year, calves);
    } else {
      legacy += 1;
      animal.code = String(legacy).padStart(3, '0');
    }
  }
}
