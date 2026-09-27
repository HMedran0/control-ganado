/**
 * Seed de carga para las pruebas de rendimiento (RNF-01: búsqueda < 1 s y tablero < 2 s con
 * 5.000 animales activos y 50.000 eventos).
 *
 * Es un juego de datos **sintético**, no una finca coherente: no reproduce categorías ni
 * estados reproductivos realistas, solo volumen. Para las cifras del tablero está el seed de
 * la finca de referencia (`seed.ts`); este sirve para medir.
 *
 * Vive en una **finca aparte**, con su propio usuario y sus propios catálogos, para que no
 * contamine la finca de referencia: las dos pueden convivir en la misma base de datos y el
 * aislamiento por `farmId` hace el resto.
 *
 * Se ejecuta con `pnpm db:seed:load`. Como el otro, se niega a correr fuera de una base local.
 */

import 'dotenv/config';

import {
  addDays,
  ageInDays,
  BREED_GROUP,
  compareIsoDates,
  defaultGestationDaysForGroup,
  EXIT_TYPE,
  nextDueOnFromInterval,
  ORIGIN,
  PREGNANCY_OUTCOME,
  ROLE,
  SERVICE_METHOD,
  SEX,
  VACCINE_SCHEDULE_TYPE,
  WEIGHT_METHOD,
  type IsoDate,
} from '@hato/shared';

import { createSeedClient, type SeedClient } from './client.js';
import { assertSeedAllowed, resolveSeedToday, SeedRefusedError } from './guards.js';
import { createIdFactory, instantOf } from './ids.js';
import { hashSeedPassword, readSeedPassword } from './password.js';
import { createRandom, LOAD_FARM_SEED } from './random.js';
import { resetFarmData } from './write.js';

/** Tamaño del juego de datos (RNF-01). */
const SIZE = {
  animals: 5_000,
  vaccinations: 24_000,
  weights: 16_000,
  pregnancies: 6_000,
  treatments: 4_000,
} as const;

/** Eventos totales: 50.000. */
const TOTAL_EVENTS = SIZE.vaccinations + SIZE.weights + SIZE.pregnancies + SIZE.treatments;

/** Filas por inserción. Más grande no acelera y hace los mensajes de error inmanejables. */
const CHUNK = 1_000;

/**
 * Desplazamiento del reloj de los identificadores respecto al seed de referencia, para que
 * las dos fincas ocupen rangos distintos de UUIDv7 y se distingan de un vistazo.
 */
const ID_EPOCH_OFFSET_MS = 86_400_000;

const LOAD_FARM = {
  name: 'Finca de carga (pruebas de rendimiento)',
  username: 'carga.admin',
} as const;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function day(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Cronómetro por etapa, para que el informe diga dónde se va el tiempo. */
function stopwatch(): { lap: (label: string, rows: number) => void; total: () => number } {
  const started = performance.now();
  let previous = started;
  return {
    lap: (label, rows) => {
      const now = performance.now();
      const elapsed = Math.round(now - previous);
      previous = now;
      const perSecond = elapsed === 0 ? rows : Math.round((rows / elapsed) * 1000);
      write(
        `  ${String(rows).padStart(7)} ${label.padEnd(16)} ${String(elapsed).padStart(6)} ms  (${perSecond}/s)`,
      );
    },
    total: () => Math.round(performance.now() - started),
  };
}

async function inChunks<T>(
  rows: readonly T[],
  write_: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < rows.length; index += CHUNK) {
    await write_(rows.slice(index, index + CHUNK));
  }
}

async function main(): Promise<void> {
  const databaseUrl = assertSeedAllowed(process.env);
  const today = resolveSeedToday(process.env);
  const password = readSeedPassword(process.env);

  const random = createRandom(LOAD_FARM_SEED);
  const ids = createIdFactory(random, ID_EPOCH_OFFSET_MS);
  const prisma: SeedClient = createSeedClient(databaseUrl);

  const farmId = ids.next();
  const userId = ids.next();
  const membershipId = ids.next();
  const breedId = ids.next();
  const lotId = ids.next();
  const vaccineId = ids.next();
  const createdAt = instantOf(today);

  write(`Seed de carga: ${SIZE.animals} animales y ${TOTAL_EVENTS} eventos.`);
  const clock = stopwatch();

  try {
    await resetFarmData(prisma, farmId, [LOAD_FARM.username]);

    await prisma.farm.create({
      data: {
        id: farmId,
        name: LOAD_FARM.name,
        municipality: 'San Juan Nepomuceno',
        department: 'Bolívar',
        settings: {},
        createdAt,
        updatedAt: createdAt,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Administrador de carga',
        username: LOAD_FARM.username,
        passwordHash: await hashSeedPassword(password, random),
        createdAt,
        updatedAt: createdAt,
        memberships: { create: { id: membershipId, farmId, role: ROLE.ADMIN } },
      },
    });
    await prisma.breed.create({
      data: {
        id: breedId,
        farmId,
        name: 'Brahman',
        group: BREED_GROUP.INDICUS,
        gestationDays: defaultGestationDaysForGroup(BREED_GROUP.INDICUS),
      },
    });
    await prisma.lot.create({ data: { id: lotId, farmId, name: 'Lote de carga' } });
    await prisma.vaccine.create({
      data: {
        id: vaccineId,
        farmId,
        name: 'Aftosa',
        disease: 'Fiebre aftosa',
        scheduleType: VACCINE_SCHEDULE_TYPE.INTERVAL,
        boosterIntervalDays: 180,
      },
    });
    clock.lap('catálogos', 5);

    // --- Animales ---
    const animals = Array.from({ length: SIZE.animals }, (_, index) => {
      const birthDate = addDays(today, -random.int(30, 3_650));
      // Un 4 % ya salió del hato, para que las consultas tengan que filtrar de verdad.
      const exited = random.chance(0.04);
      return {
        id: ids.next(),
        farmId,
        code: `C-${String(index + 1).padStart(5, '0')}`,
        sex: random.chance(0.5) ? SEX.MALE : SEX.FEMALE,
        breedId,
        birthDate: day(birthDate),
        birthDateEstimated: false,
        origin: ORIGIN.BORN_ON_FARM,
        entryDate: day(birthDate),
        lotId,
        forSale: random.chance(0.05),
        exitType: exited ? EXIT_TYPE.SALE : null,
        exitDate: exited ? day(addDays(today, -random.int(1, 400))) : null,
        createdById: userId,
        updatedById: userId,
        createdAt,
        updatedAt: createdAt,
        iso: birthDate,
      };
    });

    await inChunks(animals, (chunk) =>
      prisma.animal.createMany({
        data: chunk.map(({ iso: _iso, ...row }) => row),
      }),
    );
    clock.lap('animales', animals.length);

    const pick = (): (typeof animals)[number] => {
      const animal = animals[random.int(0, animals.length - 1)];
      if (animal === undefined) throw new Error('No hay animales para el evento.');
      return animal;
    };

    /** Fecha de evento válida: posterior al nacimiento y no futura (RN-14). */
    const eventDate = (animal: (typeof animals)[number]): IsoDate => {
      const span = Math.max(1, ageInDays(animal.iso, today));
      return addDays(animal.iso, random.int(1, span));
    };

    // --- Vacunaciones ---
    const vaccinations = Array.from({ length: SIZE.vaccinations }, () => {
      const animal = pick();
      const appliedOn = eventDate(animal);
      return {
        id: ids.next(),
        farmId,
        animalId: animal.id,
        vaccineId,
        appliedOn: day(appliedOn),
        dose: '2 ml',
        responsible: 'Vacunador',
        nextDueOn: day(nextDueOnFromInterval(appliedOn, 180) ?? appliedOn),
        createdById: userId,
        createdAt,
      };
    });
    await inChunks(vaccinations, (chunk) => prisma.vaccinationRecord.createMany({ data: chunk }));
    clock.lap('vacunaciones', vaccinations.length);

    // --- Pesajes ---
    const weights = Array.from({ length: SIZE.weights }, () => {
      const animal = pick();
      const weighedOn = eventDate(animal);
      return {
        id: ids.next(),
        farmId,
        animalId: animal.id,
        weighedOn: day(weighedOn),
        weightKg: `${random.int(35, 520)}.00`,
        method: WEIGHT_METHOD.TAPE,
        isBirthWeight: false,
        createdById: userId,
        createdAt,
      };
    });
    await inChunks(weights, (chunk) => prisma.weightRecord.createMany({ data: chunk }));
    clock.lap('pesajes', weights.length);

    // --- Preñeces: solo hembras, y una sola abierta por hembra (RN-03) ---
    const females = animals.filter((animal) => animal.sex === SEX.FEMALE);
    const openDams = new Set<string>();
    const gestation = defaultGestationDaysForGroup(BREED_GROUP.INDICUS);
    const pregnancies = Array.from({ length: SIZE.pregnancies }, () => {
      const dam = females[random.int(0, females.length - 1)];
      if (dam === undefined) throw new Error('No hay hembras para las preñeces.');

      // El servicio se echa hacia atrás lo suficiente para que el parto ya haya ocurrido,
      // salvo en las que se dejan abiertas: un parto futuro rompería RN-14.
      const serviceDate = eventDate(dam);
      const calving = addDays(serviceDate, gestation);
      const stillCarrying = compareIsoDates(calving, today) > 0;
      // Una hembra no puede tener dos preñeces abiertas (RN-03).
      const open = stillCarrying && !openDams.has(dam.id);
      if (open) openDams.add(dam.id);

      return {
        id: ids.next(),
        farmId,
        damId: dam.id,
        serviceDate: day(serviceDate),
        serviceDateEstimated: false,
        method: SERVICE_METHOD.NATURAL,
        expectedCalvingDate: day(calving),
        outcome: open ? PREGNANCY_OUTCOME.PENDING : PREGNANCY_OUTCOME.CALVED,
        outcomeDate: open ? null : day(stillCarrying ? today : calving),
        confirmedAt: day(addDays(serviceDate, 60)),
        stillbornCount: 0,
        isImported: true,
        createdById: userId,
        updatedById: userId,
        createdAt,
        updatedAt: createdAt,
      };
    });
    await inChunks(pregnancies, (chunk) => prisma.pregnancy.createMany({ data: chunk }));
    clock.lap('preñeces', pregnancies.length);

    // --- Tratamientos ---
    const treatments = Array.from({ length: SIZE.treatments }, () => {
      const animal = pick();
      const startedOn = eventDate(animal);
      return {
        id: ids.next(),
        farmId,
        animalId: animal.id,
        startedOn: day(startedOn),
        reason: 'Tratamiento sintético',
        medication: 'Oxitetraciclina',
        durationDays: 3,
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 7,
        withdrawalUntil: day(addDays(startedOn, 31)),
        createdById: userId,
        createdAt,
      };
    });
    await inChunks(treatments, (chunk) => prisma.treatmentRecord.createMany({ data: chunk }));
    clock.lap('tratamientos', treatments.length);

    const events = vaccinations.length + weights.length + pregnancies.length + treatments.length;
    write(
      `Listo en ${clock.total()} ms: ${animals.length} animales y ${events} eventos en la finca «${LOAD_FARM.name}».`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SeedRefusedError) {
    write(`Seed de carga cancelado: ${error.message}`);
  } else {
    write(String(error instanceof Error ? (error.stack ?? error.message) : error));
  }
  process.exitCode = 1;
}
