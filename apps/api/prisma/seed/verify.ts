/**
 * Comprobación del hato generado, **antes** de escribir nada en la base de datos.
 *
 * Dos cosas distintas se verifican aquí:
 *
 * 1. que las cifras del tablero coincidan con `expected.ts`, recalculándolas con las
 *    funciones de `@hato/shared` —nunca con lo que el generador creía estar haciendo—, que
 *    es lo que exige CLAUDE.md regla 5 y RN-27;
 * 2. que los datos respeten las reglas de negocio que un seed podría violar sin que nadie
 *    se diera cuenta: fechas de eventos imposibles (RN-14), servicios en hembras
 *    demasiado jóvenes (RN-15), crías nacidas antes de que su madre tuviera edad
 *    reproductiva (RN-23), más de una preñez abierta por hembra (RN-03), gestación que no
 *    corresponde a la raza de la madre (RN-04) y repartos de gasto que no suman (RN-17).
 *
 * Si algo falla, el seed se detiene con la lista completa de problemas: es preferible no
 * sembrar a sembrar un hato que contradice la especificación.
 */

import {
  ageInDays,
  ageInMonths,
  compareIsoDates,
  daysBetween,
  derivedTags,
  isWithin,
  managementCategory,
  parseMoney,
  PREGNANCY_OUTCOME,
  SEX,
  sumMoney,
  vaccineStatus,
  VACCINE_STATUS,
  type IsoDate,
  type VaccinationRecordLike,
} from '@hato/shared';

import { CYCLES, VACCINES, type Catalog, type SeedCycle, type SeedVaccine } from './catalog.js';
import type { SeedExpense } from './economics.js';
import {
  EXPECTED_BIRTHS_2026,
  EXPECTED_EXITS,
  EXPECTED_INVENTORY,
  EXPECTED_LOTS,
  EXPECTED_REPRODUCTION,
  EXPECTED_VACCINES_AT_SECOND_DATE,
  EXPECTED_VACCINES_TODAY,
  SECOND_EVALUATION,
  type VaccineTally,
} from './expected.js';
import type { Herd, SeedAnimal } from './herd.js';
import type { History } from './history.js';
import { LOTS } from './catalog.js';

/** Problemas encontrados; vacío si el hato cumple el contrato. */
export type VerificationResult = { readonly problems: readonly string[] };

/** Ciclo en curso y último ciclo cerrado en una fecha dada. */
export function cyclesAt(date: IsoDate): {
  current: SeedCycle | null;
  lastClosed: SeedCycle | null;
} {
  const current = CYCLES.find((cycle) => isWithin(date, cycle.startsOn, cycle.endsOn)) ?? null;
  const closed = CYCLES.filter((cycle) => compareIsoDates(cycle.endsOn, date) < 0);
  return { current, lastClosed: closed.at(-1) ?? null };
}

/** Recuento de estados de una vacuna sobre los animales activos. */
export function tallyVaccine(
  vaccine: SeedVaccine,
  animals: readonly SeedAnimal[],
  recordsFor: (animalId: string, key: SeedVaccine['key']) => VaccinationRecordLike[],
  alertDays: number,
  date: IsoDate,
): VaccineTally {
  const { current, lastClosed } = cyclesAt(date);
  const tally = { upToDate: 0, pending: 0, overdue: 0, upcoming: 0, notApplicable: 0 };

  for (const animal of animals) {
    const status = vaccineStatus({
      vaccine,
      animal: { sex: animal.sex, birthDate: animal.birthDate, entryDate: animal.entryDate },
      records: recordsFor(animal.id, vaccine.key),
      currentCycle: current,
      lastClosedCycle: lastClosed,
      alertDays,
      today: date,
    });

    if (status.kind === VACCINE_STATUS.UP_TO_DATE) tally.upToDate += 1;
    else if (status.kind === VACCINE_STATUS.PENDING) tally.pending += 1;
    else if (status.kind === VACCINE_STATUS.OVERDUE) tally.overdue += 1;
    else if (status.kind === VACCINE_STATUS.UPCOMING) tally.upcoming += 1;
    else tally.notApplicable += 1;
  }
  return tally;
}

/** Comprueba el hato completo contra `expected.ts` y las reglas de negocio. */
export function verifyHerd(
  herd: Herd,
  history: History,
  expenses: readonly SeedExpense[],
  catalog: Catalog,
  today: IsoDate,
): VerificationResult {
  const problems: string[] = [];
  const check = (what: string, actual: number, expected: number): void => {
    if (actual !== expected) problems.push(`${what}: se esperaban ${expected} y hay ${actual}.`);
  };

  const active = herd.animals.filter((animal) => animal.exitType === null);
  const { weaningAgeMonths, minBreedingAgeMonths } = catalog.settings;

  // --- Partos y preñeces abiertas por hembra ---
  const calvings = new Map<string, IsoDate[]>();
  const openPregnancies = new Map<string, { confirmed: boolean; service: IsoDate; ecd: IsoDate }>();
  for (const pregnancy of herd.pregnancies) {
    if (pregnancy.outcome === PREGNANCY_OUTCOME.CALVED && pregnancy.outcomeDate !== null) {
      calvings.set(pregnancy.damId, [
        ...(calvings.get(pregnancy.damId) ?? []),
        pregnancy.outcomeDate,
      ]);
    }
    if (pregnancy.outcome === PREGNANCY_OUTCOME.PENDING) {
      if (openPregnancies.has(pregnancy.damId)) {
        problems.push(`RN-03: la hembra ${pregnancy.damId} tiene más de una preñez abierta.`);
      }
      openPregnancies.set(pregnancy.damId, {
        confirmed: pregnancy.confirmedAt !== null,
        service: pregnancy.serviceDate,
        ecd: pregnancy.expectedCalvingDate,
      });
    }
  }

  // --- Inventario, categorías y etiquetas, todo recalculado con shared ---
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  let males = 0;
  let servedOver90 = 0;
  let dueSoon = 0;
  let forSale = 0;

  for (const animal of active) {
    const damCalvings = calvings.get(animal.id) ?? [];
    const open = openPregnancies.get(animal.id);
    const category = managementCategory({
      sex: animal.sex,
      birthDate: animal.birthDate,
      calvingCount: damCalvings.length,
      weaningAgeMonths,
      today,
    });
    categories.set(category, (categories.get(category) ?? 0) + 1);
    if (animal.sex === SEX.MALE) males += 1;
    if (animal.forSale) forSale += 1;

    const lastCalving =
      damCalvings.length === 0
        ? null
        : damCalvings.reduce((latest, date) => (date > latest ? date : latest));

    for (const tag of derivedTags({
      category,
      hasOpenConfirmedPregnancy: open?.confirmed === true,
      hasOpenUnconfirmedPregnancy: open !== undefined && !open.confirmed,
      calvingCount: damCalvings.length,
      lastCalvingDate: lastCalving,
      withdrawalUntil: history.withdrawalUntilByAnimal.get(animal.id) ?? null,
      weaningAgeMonths,
      today,
    })) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }

    if (open !== undefined && !open.confirmed && daysBetween(open.service, today) > 90) {
      servedOver90 += 1;
    }
    if (open?.confirmed === true) {
      if (compareIsoDates(open.ecd, today) < 0) {
        problems.push(`Preñez confirmada de ${animal.code} con parto previsto ya vencido.`);
      } else if (daysBetween(today, open.ecd) <= catalog.settings.calvingAlertDays) {
        dueSoon += 1;
      }
    }
  }

  check('Animales en la base', herd.animals.length, EXPECTED_INVENTORY.total);
  check('Animales activos', active.length, EXPECTED_INVENTORY.active);
  check('Machos activos', males, EXPECTED_INVENTORY.males);
  check('Hembras activas', active.length - males, EXPECTED_INVENTORY.females);
  for (const [category, expected] of Object.entries(EXPECTED_INVENTORY.category)) {
    check(`Categoría ${category}`, categories.get(category) ?? 0, expected);
  }

  check('Preñadas', tags.get('PREGNANT') ?? 0, EXPECTED_REPRODUCTION.pregnant);
  check('Servidas', tags.get('SERVED') ?? 0, EXPECTED_REPRODUCTION.served);
  check('Servidas hace más de 90 días', servedOver90, EXPECTED_REPRODUCTION.servedOver90Days);
  check('Horras', tags.get('DRY') ?? 0, EXPECTED_REPRODUCTION.dry);
  check('Paridas', tags.get('CALVED') ?? 0, EXPECTED_REPRODUCTION.calved);
  check('En retiro', tags.get('WITHDRAWAL') ?? 0, EXPECTED_REPRODUCTION.withdrawal);
  check('Partos próximos', dueSoon, EXPECTED_REPRODUCTION.calvingsDueSoon);
  check('Disponibles para venta', forSale, EXPECTED_EXITS.forSale);

  const withCalfAtFoot = active.filter((cow) =>
    active.some(
      (calf) => calf.damId === cow.id && ageInMonths(calf.birthDate, today) < weaningAgeMonths,
    ),
  ).length;
  check('Vacas con cría al pie', withCalfAtFoot, EXPECTED_REPRODUCTION.withCalfAtFoot);

  // --- Nacimientos del año, sin filtrar por salida (NAC-01) ---
  const born2026 = herd.animals.filter((animal) => animal.birthDate.startsWith('2026'));
  check('Nacidos vivos en 2026', born2026.length, EXPECTED_BIRTHS_2026.live);
  check(
    'Machos nacidos en 2026',
    born2026.filter((animal) => animal.sex === SEX.MALE).length,
    EXPECTED_BIRTHS_2026.liveMales,
  );
  check(
    'Hembras nacidas en 2026',
    born2026.filter((animal) => animal.sex === SEX.FEMALE).length,
    EXPECTED_BIRTHS_2026.liveFemales,
  );
  check(
    'Muertos al nacer en 2026',
    herd.pregnancies.reduce(
      (sum, pregnancy) =>
        sum + (pregnancy.outcomeDate?.startsWith('2026') === true ? pregnancy.stillbornCount : 0),
      0,
    ),
    EXPECTED_BIRTHS_2026.stillborn,
  );

  check(
    'Vendidos',
    herd.animals.filter((animal) => animal.exitType === 'SALE').length,
    EXPECTED_EXITS.sold,
  );
  check(
    'Muertos',
    herd.animals.filter((animal) => animal.exitType === 'DEATH').length,
    EXPECTED_EXITS.dead,
  );

  for (const lot of LOTS) {
    const expected = EXPECTED_LOTS[lot.name];
    check(
      `Lote ${lot.name}`,
      active.filter((animal) => animal.lotKey === lot.key).length,
      expected,
    );
  }

  // --- Estado de vacunas en las dos fechas ---
  const records = new Map<string, VaccinationRecordLike[]>();
  for (const record of history.vaccinations) {
    const key = `${record.animalId}|${record.vaccineKey}`;
    records.set(key, [
      ...(records.get(key) ?? []),
      { appliedOn: record.appliedOn, nextDueOn: record.nextDueOn, voided: false },
    ]);
  }
  const recordsFor = (animalId: string, key: SeedVaccine['key']): VaccinationRecordLike[] =>
    records.get(`${animalId}|${key}`) ?? [];

  for (const [date, expectedTable] of [
    [today, EXPECTED_VACCINES_TODAY],
    [SECOND_EVALUATION, EXPECTED_VACCINES_AT_SECOND_DATE],
  ] as const) {
    for (const vaccine of VACCINES) {
      const expected = expectedTable[vaccine.name];
      if (expected === undefined) {
        problems.push(`Falta la vacuna ${vaccine.name} en las cifras esperadas.`);
        continue;
      }
      const actual = tallyVaccine(
        vaccine,
        active,
        recordsFor,
        catalog.settings.vaccineAlertDays,
        date,
      );
      for (const state of Object.keys(expected) as (keyof VaccineTally)[]) {
        check(`${vaccine.name} (${date}) ${state}`, actual[state], expected[state]);
      }
    }
  }

  // --- Reglas que un seed puede romper en silencio ---
  for (const animal of herd.animals) {
    if (compareIsoDates(animal.birthDate, today) > 0) {
      problems.push(`RN-14: ${animal.code} nació en el futuro (${animal.birthDate}).`);
    }
    if (compareIsoDates(animal.entryDate, animal.birthDate) < 0) {
      problems.push(`${animal.code} ingresó a la finca antes de nacer.`);
    }
    if (animal.exitDate !== null && compareIsoDates(animal.exitDate, animal.birthDate) < 0) {
      problems.push(`${animal.code} salió de la finca antes de nacer.`);
    }
    if (animal.exitDate !== null && compareIsoDates(animal.exitDate, today) > 0) {
      problems.push(`RN-14: la salida de ${animal.code} es futura.`);
    }
    if ((animal.exitType === null) !== (animal.exitDate === null)) {
      problems.push(`${animal.code} tiene tipo y fecha de salida incoherentes.`);
    }

    const dam = animal.damId === null ? undefined : herd.byId.get(animal.damId);
    if (dam !== undefined) {
      if (dam.sex !== SEX.FEMALE) problems.push(`RN-02: la madre de ${animal.code} no es hembra.`);
      if (ageInMonths(dam.birthDate, animal.birthDate) < minBreedingAgeMonths) {
        problems.push(
          `RN-23: ${animal.code} nació cuando su madre tenía ` +
            `${ageInMonths(dam.birthDate, animal.birthDate)} meses.`,
        );
      }
    }
    const sire = animal.sireId === null ? undefined : herd.byId.get(animal.sireId);
    if (sire !== undefined && sire.sex !== SEX.MALE) {
      problems.push(`RN-02: el padre de ${animal.code} no es macho.`);
    }
  }

  const duplicateCodes = new Set<string>();
  const seenCodes = new Set<string>();
  for (const animal of herd.animals) {
    if (seenCodes.has(animal.code)) duplicateCodes.add(animal.code);
    seenCodes.add(animal.code);
  }
  if (duplicateCodes.size > 0) {
    problems.push(`RN-01: códigos repetidos: ${[...duplicateCodes].join(', ')}.`);
  }

  for (const pregnancy of herd.pregnancies) {
    const dam = herd.byId.get(pregnancy.damId);
    if (dam === undefined) {
      problems.push(`Preñez ${pregnancy.id} sin madre en el hato.`);
      continue;
    }
    if (dam.sex !== SEX.FEMALE) {
      problems.push(`RN-02: la preñez ${pregnancy.id} es de un macho.`);
    }
    if (compareIsoDates(pregnancy.serviceDate, today) > 0) {
      problems.push(`RN-14: servicio futuro en la preñez de ${dam.code}.`);
    }
    if (ageInMonths(dam.birthDate, pregnancy.serviceDate) < minBreedingAgeMonths) {
      problems.push(
        `RN-15: ${dam.code} fue servida a los ` +
          `${ageInMonths(dam.birthDate, pregnancy.serviceDate)} meses, por debajo de los ` +
          `${minBreedingAgeMonths} de la finca.`,
      );
    }
    if (pregnancy.confirmedAt !== null) {
      if (compareIsoDates(pregnancy.confirmedAt, today) > 0) {
        problems.push(`RN-14: palpación futura en la preñez de ${dam.code}.`);
      }
      if (compareIsoDates(pregnancy.confirmedAt, pregnancy.serviceDate) < 0) {
        problems.push(`Palpación anterior al servicio en la preñez de ${dam.code}.`);
      }
    }
    if (pregnancy.outcomeDate !== null && compareIsoDates(pregnancy.outcomeDate, today) > 0) {
      problems.push(`RN-14: parto futuro en la preñez de ${dam.code}.`);
    }

    // RN-04: la gestación es la de la raza de la madre, no la de la finca.
    const gestation = catalog.breedGestationDays.get(dam.breedName);
    if (gestation !== undefined) {
      const applied = daysBetween(pregnancy.serviceDate, pregnancy.expectedCalvingDate);
      if (applied !== gestation) {
        problems.push(
          `RN-04: la preñez de ${dam.code} (${dam.breedName}) usa ${applied} días de ` +
            `gestación en lugar de ${gestation}.`,
        );
      }
    }
    if (pregnancy.stillbornCount < 0 || pregnancy.stillbornCount > 3) {
      problems.push(`Mortinatos fuera de rango en la preñez de ${dam.code}.`);
    }
  }

  // --- Eventos posteriores al nacimiento y anteriores a hoy (RN-14) ---
  const eventChecks: { what: string; animalId: string; date: IsoDate }[] = [
    ...history.vaccinations.map((record) => ({
      what: 'vacunación',
      animalId: record.animalId,
      date: record.appliedOn,
    })),
    ...history.weights.map((record) => ({
      what: 'pesaje',
      animalId: record.animalId,
      date: record.weighedOn,
    })),
    ...history.treatments.map((record) => ({
      what: 'tratamiento',
      animalId: record.animalId,
      date: record.startedOn,
    })),
    ...history.identifiers.map((record) => ({
      what: 'identificador',
      animalId: record.animalId,
      date: record.assignedAt,
    })),
  ];

  for (const event of eventChecks) {
    const animal = herd.byId.get(event.animalId);
    if (animal === undefined) {
      problems.push(`Hay un ${event.what} de un animal que no existe.`);
      continue;
    }
    if (compareIsoDates(event.date, animal.birthDate) < 0) {
      problems.push(`RN-14: ${event.what} de ${animal.code} anterior a su nacimiento.`);
    }
    if (compareIsoDates(event.date, today) > 0) {
      problems.push(`RN-14: ${event.what} de ${animal.code} en el futuro.`);
    }
  }

  // --- Brucelosis: nunca en machos (RN-26) ---
  for (const record of history.vaccinations) {
    if (record.vaccineKey !== 'BRUCELLOSIS') continue;
    const animal = herd.byId.get(record.animalId);
    if (animal !== undefined && animal.sex === SEX.MALE) {
      problems.push(`RN-26: brucelosis registrada en el macho ${animal.code}.`);
    }
  }

  // --- Identificadores activos únicos por finca y tipo (RN-19) ---
  const identifierKeys = new Set<string>();
  for (const identifier of history.identifiers) {
    const key = `${identifier.type}|${identifier.value}`;
    if (identifierKeys.has(key)) problems.push(`RN-19: identificador repetido ${key}.`);
    identifierKeys.add(key);
  }

  // --- Reparto exacto de los gastos (RN-17) ---
  for (const expense of expenses) {
    const total = sumMoney(expense.allocations.map((allocation) => allocation.amount));
    if (parseMoney(total) !== parseMoney(expense.amount)) {
      problems.push(
        `RN-17: «${expense.description}» reparte ${total} de un gasto de ${expense.amount}.`,
      );
    }
  }

  // --- Ventana de brucelosis: las pendientes son hembras de 90 a 270 días ---
  const brucellosis = VACCINES.find((vaccine) => vaccine.key === 'BRUCELLOSIS');
  if (brucellosis !== undefined) {
    for (const animal of active) {
      if (animal.sex !== SEX.FEMALE) continue;
      const hasRecord = recordsFor(animal.id, 'BRUCELLOSIS').length > 0;
      const age = ageInDays(animal.birthDate, today);
      if (!hasRecord && age > (brucellosis.maxAgeDays ?? 270)) {
        problems.push(`La hembra ${animal.code} quedó fuera de la ventana de brucelosis.`);
      }
    }
  }

  return { problems };
}
