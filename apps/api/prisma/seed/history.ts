/**
 * Historial sanitario y de pesos de la finca de referencia (08 §3.2 y §3.3).
 *
 * Las jornadas son las de `plan.ts` y su calendario es lo que determina el estado de cada
 * vacuna hoy. No se escribe ningún estado: `vaccineStatus` lo deduce de estos registros.
 *
 * - **Aftosa y rabia** (`OFFICIAL_CYCLE`): una jornada por ciclo oficial, con el número de
 *   RUV que expide el vacunador de Fedegán. Seis animales se perdieron la jornada de 2026 y
 *   quedan vencidos; las crías nacidas después del cierre del ciclo no aplican (ADR-004).
 * - **Brucelosis** (`AGE_WINDOW`): una sola aplicación en la vida, hacia los cinco meses.
 *   Catorce hembras de 90 a 270 días se quedan sin ella: son las pendientes de 08 §3.2.
 * - **Clostridial** (`INTERVAL` 365): jornada anual en marzo. Los toros y los bueyes la
 *   reciben en la visita de octubre, así que su refuerzo cae dentro de la ventana de alerta.
 * - **Pesajes**: cinta bovinométrica (la finca no tiene báscula, 08 §1.7), peso al nacer de
 *   cada cría y pesaje trimestral del levante.
 */

import {
  addDays,
  ageInDays,
  compareIsoDates,
  isWithin,
  maxIsoDate,
  minIsoDate,
  nextDueOnFromInterval,
  SEX,
  WEIGHT_METHOD,
  type IsoDate,
  type WeightMethod,
} from '@hato/shared';

import { CYCLES, VACCINES, type SeedVaccine } from './catalog.js';
import type { SeedAnimal } from './herd.js';
import type { IdFactory } from './ids.js';
import {
  BRAND_AGE_DAYS,
  BRUCELLOSIS_AGE_DAYS,
  BRUCELLOSIS_PENDING,
  MISSED_OFFICIAL_CYCLE,
  VACCINATION_DAYS,
  WEIGHING_DAYS,
} from './plan.js';
import type { SeededRandom } from './random.js';

/** Registro de vacunación listo para escribir. */
export type SeedVaccination = {
  readonly id: string;
  readonly animalId: string;
  readonly vaccineKey: SeedVaccine['key'];
  readonly appliedOn: IsoDate;
  readonly dose: string;
  readonly batchNumber: string | null;
  readonly ruvNumber: string | null;
  readonly cycleName: string | null;
  readonly responsible: string;
  readonly nextDueOn: IsoDate | null;
  readonly workSessionKey: string | null;
};

/** Pesaje listo para escribir. */
export type SeedWeight = {
  readonly id: string;
  readonly animalId: string;
  readonly weighedOn: IsoDate;
  readonly weightKg: string;
  readonly method: WeightMethod;
  readonly isBirthWeight: boolean;
  readonly workSessionKey: string | null;
};

/** Tratamiento listo para escribir. */
export type SeedTreatment = {
  readonly id: string;
  readonly animalId: string;
  readonly startedOn: IsoDate;
  readonly reason: string;
  readonly medication: string;
  readonly dose: string;
  readonly durationDays: number;
  readonly withdrawalMeatDays: number;
  readonly withdrawalMilkDays: number;
  readonly withdrawalUntil: IsoDate;
  readonly responsible: string;
};

/** Identificador listo para escribir. */
export type SeedIdentifier = {
  readonly id: string;
  readonly animalId: string;
  readonly type: 'VISUAL_TAG' | 'DIN' | 'BRAND';
  readonly value: string;
  readonly assignedAt: IsoDate;
};

/** Jornada de manejo: agrupa los registros de un mismo día. */
export type SeedWorkSession = {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly sessionDate: IsoDate;
  readonly activities: readonly Record<string, string>[];
};

/** Movimiento de lote listo para escribir. */
export type SeedLotMovement = {
  readonly id: string;
  readonly animalId: string;
  readonly toLotKey: SeedAnimal['lotKey'];
  readonly movedOn: IsoDate;
};

/** Todo el historial generado. */
export type History = {
  readonly vaccinations: readonly SeedVaccination[];
  readonly weights: readonly SeedWeight[];
  readonly treatments: readonly SeedTreatment[];
  readonly identifiers: readonly SeedIdentifier[];
  readonly workSessions: readonly SeedWorkSession[];
  readonly lotMovements: readonly SeedLotMovement[];
  /** Animales con retiro vigente hoy, para comprobar la etiqueta «En retiro». */
  readonly withdrawalUntilByAnimal: ReadonlyMap<string, IsoDate>;
};

/** ¿El animal estaba en la finca ese día, sin haber salido todavía? */
function presentOn(animal: SeedAnimal, date: IsoDate): boolean {
  if (compareIsoDates(animal.entryDate, date) > 0) return false;
  return animal.exitDate === null || compareIsoDates(animal.exitDate, date) > 0;
}

/**
 * Peso estimado con cinta, en kilos.
 *
 * Curva sencilla: peso al nacer más una ganancia diaria que baja con la edad. No pretende
 * ser un modelo zootécnico, solo dar cifras coherentes para probar listados y reportes.
 */
function tapeWeight(ageDays: number, birthWeight: number, dailyGain: number): number {
  const growth =
    ageDays <= 210 ? ageDays * dailyGain : 210 * dailyGain + (ageDays - 210) * dailyGain * 0.7;
  return Math.round((birthWeight + growth) * 2) / 2;
}

/** Construye todo el historial sanitario, de pesos y de identificación. */
export function buildHistory(
  animals: readonly SeedAnimal[],
  random: SeededRandom,
  ids: IdFactory,
  today: IsoDate,
): History {
  const vaccinations: SeedVaccination[] = [];
  const weights: SeedWeight[] = [];
  const treatments: SeedTreatment[] = [];
  const identifiers: SeedIdentifier[] = [];
  const lotMovements: SeedLotMovement[] = [];

  const officialVaccines = VACCINES.filter((vaccine) => vaccine.inOfficialCycle);
  const active = animals.filter((animal) => animal.exitType === null);

  // --- Jornadas de manejo: los registros del mismo día quedan agrupados ---
  const sessions: SeedWorkSession[] = [
    {
      key: 'CICLO-2025-2',
      id: ids.next(),
      name: 'Ciclo oficial 2025-2: aftosa y rabia',
      sessionDate: VACCINATION_DAYS.cycle2025,
      activities: officialVaccines.map((vaccine) => ({
        type: 'VACCINATION',
        vaccine: vaccine.name,
      })),
    },
    {
      key: 'CICLO-2026-1',
      id: ids.next(),
      name: 'Ciclo oficial 2026-1: aftosa y rabia',
      sessionDate: VACCINATION_DAYS.cycle2026,
      activities: officialVaccines.map((vaccine) => ({
        type: 'VACCINATION',
        vaccine: vaccine.name,
      })),
    },
    {
      key: 'CLOSTRIDIAL-2026',
      id: ids.next(),
      name: 'Jornada anual de clostridial',
      sessionDate: VACCINATION_DAYS.clostridial2026,
      activities: [{ type: 'VACCINATION', vaccine: 'Clostridial polivalente' }],
    },
    {
      key: 'PESAJE-2026-09',
      id: ids.next(),
      name: 'Pesaje trimestral del levante',
      sessionDate: WEIGHING_DAYS.at(-1) ?? today,
      activities: [{ type: 'WEIGHT' }],
    },
  ];

  // --- Aftosa y rabia: una jornada por ciclo oficial, con RUV ---
  // Los seis que se perdieron la jornada de 2026 se eligen entre los que ya estaban en la
  // finca: son los que quedan vencidos en el tablero.
  const eligibleForMiss = active.filter((animal) => presentOn(animal, VACCINATION_DAYS.cycle2026));
  const missed = new Set(
    random
      .shuffle(eligibleForMiss)
      .slice(0, MISSED_OFFICIAL_CYCLE)
      .map((animal) => animal.id),
  );

  const cycleDays = [
    { cycle: '2025-2', day: VACCINATION_DAYS.cycle2025, session: 'CICLO-2025-2' },
    { cycle: '2026-1', day: VACCINATION_DAYS.cycle2026, session: 'CICLO-2026-1' },
  ] as const;

  for (const { cycle, day, session } of cycleDays) {
    const window = CYCLES.find((item) => item.name === cycle);
    if (window === undefined) throw new Error(`Falta el ciclo ${cycle} en el catálogo.`);
    if (!isWithin(day, window.startsOn, window.endsOn)) {
      throw new Error(`La jornada ${day} cae fuera del ciclo ${cycle}.`);
    }

    const ruv = `RUV-${cycle.replace('-', '')}-${String(random.int(10_000, 99_999))}`;
    for (const animal of animals) {
      if (!presentOn(animal, day)) continue;
      if (cycle === '2026-1' && missed.has(animal.id)) continue;

      for (const vaccine of officialVaccines) {
        vaccinations.push({
          id: ids.next(),
          animalId: animal.id,
          vaccineKey: vaccine.key,
          appliedOn: day,
          dose: vaccine.defaultDose,
          batchNumber: `L${cycle.replace('-', '')}${random.int(100, 999)}`,
          ruvNumber: ruv,
          cycleName: cycle,
          responsible: 'Vacunador de Fedegán',
          nextDueOn: null,
          workSessionKey: session,
        });
      }
    }
  }

  // --- Brucelosis: una sola aplicación en la vida, hacia los cinco meses ---
  const brucellosis = VACCINES.find((vaccine) => vaccine.key === 'BRUCELLOSIS');
  if (brucellosis === undefined) throw new Error('Falta la brucelosis en el catálogo.');
  const minAge = brucellosis.minAgeDays ?? 90;
  const maxAge = brucellosis.maxAgeDays ?? 270;

  const femalesInWindow = active.filter(
    (animal) =>
      animal.sex === SEX.FEMALE &&
      ageInDays(animal.birthDate, today) >= minAge &&
      ageInDays(animal.birthDate, today) <= maxAge,
  );
  const pendingBrucellosis = new Set(
    random
      .shuffle(femalesInWindow)
      .slice(0, BRUCELLOSIS_PENDING)
      .map((animal) => animal.id),
  );

  for (const animal of animals) {
    if (animal.sex !== SEX.FEMALE) continue;
    if (pendingBrucellosis.has(animal.id)) continue;
    const age = ageInDays(animal.birthDate, today);
    if (age < minAge) continue;

    // Nunca en el futuro y nunca antes de la edad mínima de la ventana.
    const atAge = Math.min(random.int(BRUCELLOSIS_AGE_DAYS.min, BRUCELLOSIS_AGE_DAYS.max), age);
    const appliedOn = addDays(animal.birthDate, atAge);
    if (animal.exitDate !== null && compareIsoDates(appliedOn, animal.exitDate) > 0) continue;

    vaccinations.push({
      id: ids.next(),
      animalId: animal.id,
      vaccineKey: 'BRUCELLOSIS',
      appliedOn,
      dose: brucellosis.defaultDose,
      batchNumber: `RB51-${random.int(1000, 9999)}`,
      ruvNumber: null,
      cycleName: null,
      responsible: 'Dra. Paola Barrios',
      nextDueOn: null,
      workSessionKey: null,
    });
  }

  // --- Clostridial: jornada anual, y visita aparte para toros y bueyes ---
  const clostridial = VACCINES.find((vaccine) => vaccine.key === 'CLOSTRIDIAL');
  if (clostridial === undefined) throw new Error('Falta la clostridial en el catálogo.');
  const clostridialMinAge = clostridial.minAgeDays ?? 90;
  const bullsAndOxen = new Set(
    active.filter((animal) => animal.lotKey === 'TOROS').map((animal) => animal.id),
  );

  const clostridialDays = [
    { day: VACCINATION_DAYS.clostridial2025, session: null },
    { day: VACCINATION_DAYS.clostridial2026, session: 'CLOSTRIDIAL-2026' },
  ] as const;

  for (const { day, session } of clostridialDays) {
    for (const animal of animals) {
      if (bullsAndOxen.has(animal.id)) continue;
      if (!presentOn(animal, day)) continue;
      if (ageInDays(animal.birthDate, day) < clostridialMinAge) continue;

      vaccinations.push({
        id: ids.next(),
        animalId: animal.id,
        vaccineKey: 'CLOSTRIDIAL',
        appliedOn: day,
        dose: clostridial.defaultDose,
        batchNumber: `CL-${day.slice(0, 4)}-${random.int(100, 999)}`,
        ruvNumber: null,
        cycleName: null,
        responsible: 'Dra. Paola Barrios',
        nextDueOn: nextDueOnFromInterval(day, clostridial.boosterIntervalDays),
        workSessionKey: session,
      });
    }
  }

  for (const animalId of bullsAndOxen) {
    const day = VACCINATION_DAYS.clostridialBulls;
    vaccinations.push({
      id: ids.next(),
      animalId,
      vaccineKey: 'CLOSTRIDIAL',
      appliedOn: day,
      dose: clostridial.defaultDose,
      batchNumber: `CL-2025-${random.int(100, 999)}`,
      ruvNumber: null,
      cycleName: null,
      responsible: 'Dra. Paola Barrios',
      nextDueOn: nextDueOnFromInterval(day, clostridial.boosterIntervalDays),
      workSessionKey: null,
    });
  }

  // --- Pesos: al nacer y cada tres meses en el levante ---
  const birthWeightOf = new Map<string, number>();
  const dailyGainOf = new Map<string, number>();
  for (const animal of animals) {
    const birthWeight = animal.sex === SEX.MALE ? random.int(30, 38) : random.int(27, 35);
    birthWeightOf.set(animal.id, birthWeight);
    dailyGainOf.set(animal.id, random.int(45, 62) / 100);

    if (animal.origin !== 'BORN_ON_FARM') continue;
    if (compareIsoDates(animal.birthDate, addDays(today, -1000)) < 0) continue;

    weights.push({
      id: ids.next(),
      animalId: animal.id,
      weighedOn: animal.birthDate,
      weightKg: `${birthWeight}.00`,
      method: WEIGHT_METHOD.TAPE,
      isBirthWeight: true,
      workSessionKey: null,
    });
  }

  const lastWeighingDay = WEIGHING_DAYS.at(-1);
  for (const day of WEIGHING_DAYS) {
    for (const animal of animals) {
      if (animal.sex !== SEX.MALE || !presentOn(animal, day)) continue;
      const age = ageInDays(animal.birthDate, day);
      // El pesaje trimestral es del levante: machos destetados y todavía no adultos.
      if (age < 214 || age >= 730) continue;

      const birthWeight = birthWeightOf.get(animal.id) ?? 32;
      const dailyGain = dailyGainOf.get(animal.id) ?? 0.5;
      weights.push({
        id: ids.next(),
        animalId: animal.id,
        weighedOn: day,
        weightKg: `${tapeWeight(age, birthWeight, dailyGain).toFixed(2)}`,
        method: WEIGHT_METHOD.TAPE,
        isBirthWeight: false,
        workSessionKey: day === lastWeighingDay ? 'PESAJE-2026-09' : null,
      });
    }
  }

  // --- Tratamientos: dos siguen en período de retiro hoy (etiqueta «En retiro») ---
  const withdrawalUntilByAnimal = new Map<string, IsoDate>();
  const treatable = random.shuffle(active.filter((animal) => animal.lotKey !== 'TOROS'));
  const treatmentSpecs = [
    { reason: 'Herida en la pata', medication: 'Oxitetraciclina', meat: 28, milk: 7 },
    { reason: 'Mastitis clínica', medication: 'Cefalexina intramamaria', meat: 14, milk: 5 },
    { reason: 'Diarrea', medication: 'Sulfa + trimetoprim', meat: 21, milk: 4 },
    { reason: 'Gusanera en el ombligo', medication: 'Ivermectina', meat: 35, milk: 0 },
    { reason: 'Fiebre por garrapata', medication: 'Imidocarb', meat: 30, milk: 6 },
    { reason: 'Cojera', medication: 'Ketoprofeno', meat: 7, milk: 2 },
    { reason: 'Absceso', medication: 'Penicilina', meat: 21, milk: 5 },
    { reason: 'Conjuntivitis', medication: 'Oxitetraciclina tópica', meat: 10, milk: 0 },
  ];

  treatmentSpecs.forEach((spec, index) => {
    const animal = treatable[index];
    if (animal === undefined) return;
    // Los dos últimos empiezan hace pocos días: su retiro sigue vigente hoy.
    const stillInWithdrawal = index >= treatmentSpecs.length - 2;
    const durationDays = random.int(1, 5);
    // Ningún tratamiento puede ser anterior al nacimiento del animal (RN-14).
    const startedOn = maxIsoDate(
      stillInWithdrawal ? addDays(today, -random.int(2, 8)) : addDays(today, -random.int(120, 400)),
      addDays(animal.birthDate, 15),
    );
    const withdrawalUntil = addDays(startedOn, durationDays + Math.max(spec.meat, spec.milk));

    treatments.push({
      id: ids.next(),
      animalId: animal.id,
      startedOn,
      reason: spec.reason,
      medication: spec.medication,
      dose: `${random.int(5, 20)} ml`,
      durationDays,
      withdrawalMeatDays: spec.meat,
      withdrawalMilkDays: spec.milk,
      withdrawalUntil,
      responsible: 'Dra. Paola Barrios',
    });

    if (compareIsoDates(withdrawalUntil, today) >= 0) {
      withdrawalUntilByAnimal.set(animal.id, withdrawalUntil);
    }
  });

  // --- Identificación: chapeta a todos, hierro a los adultos, DIN a los nacidos en 2026 ---
  let din = 0;
  for (const animal of animals) {
    identifiers.push({
      id: ids.next(),
      animalId: animal.id,
      type: 'VISUAL_TAG',
      value: animal.code,
      assignedAt: animal.entryDate,
    });

    const brandedOn = addDays(animal.birthDate, BRAND_AGE_DAYS);
    if (
      compareIsoDates(brandedOn, today) <= 0 &&
      (animal.exitDate === null || compareIsoDates(brandedOn, animal.exitDate) < 0)
    ) {
      identifiers.push({
        id: ids.next(),
        animalId: animal.id,
        type: 'BRAND',
        // El hierro solo no identifica: el valor lleva el código, que sí es único (RN-19).
        value: `LE ${animal.code}`,
        assignedAt: brandedOn,
      });
    }

    if (animal.birthDate.startsWith('2026')) {
      din += 1;
      identifiers.push({
        id: ids.next(),
        animalId: animal.id,
        type: 'DIN',
        value: `CO13657${String(din).padStart(4, '0')}`,
        // El DIN se pone en la primera revisión después del nacimiento, nunca en el futuro.
        assignedAt: minIsoDate(addDays(animal.birthDate, random.int(5, 30)), today),
      });
    }
  }

  // --- Movimiento inicial de lote, para que la ficha tenga historia completa ---
  for (const animal of animals) {
    if (animal.exitType !== null) continue;
    lotMovements.push({
      id: ids.next(),
      animalId: animal.id,
      toLotKey: animal.lotKey,
      movedOn: animal.entryDate,
    });
  }

  return {
    vaccinations,
    weights,
    treatments,
    identifiers,
    workSessions: sessions,
    lotMovements,
    withdrawalUntilByAnimal,
  };
}

/** Último peso conocido de cada animal, para valorar y repartir gastos por peso. */
export function lastWeightByAnimal(weights: readonly SeedWeight[]): Map<string, string> {
  const latest = new Map<string, { on: IsoDate; kg: string }>();
  for (const weight of weights) {
    const current = latest.get(weight.animalId);
    if (current === undefined || compareIsoDates(weight.weighedOn, current.on) > 0) {
      latest.set(weight.animalId, { on: weight.weighedOn, kg: weight.weightKg });
    }
  }
  return new Map([...latest].map(([animalId, value]) => [animalId, value.kg]));
}
