/**
 * Escritura del hato en la base de datos.
 *
 * Tres cosas que no son obvias:
 *
 * 1. **Orden de dependencias, sin UPDATE.** `animals.birth_pregnancy_id` apunta a
 *    `pregnancies` y `pregnancies.dam_id` apunta a `animals`. Los animales van en orden de
 *    nacimiento y, antes de cada cría, la preñez de la que nació: cuando algo depende de una
 *    fila que aún no está en la base, se escribe lo acumulado. No se actualiza nada después,
 *    porque el trigger `set_updated_at()` (ADR-012) pondría la hora real en `updated_at`.
 * 2. **Marcas de tiempo deterministas.** `created_at` y `updated_at` se escriben a mano, a
 *    partir de la fecha del hecho, en lugar de dejar el `now()` de la base, también en los
 *    catálogos. Sin eso, dos ejecuciones del seed no darían un volcado idéntico y no se podría
 *    comprobar el determinismo comparando la base entera.
 * 3. **Todo en una transacción**, para que un fallo a mitad no deje media finca sembrada.
 */

import { compareIsoDates, type IsoDate } from '@hato/shared';

import {
  BREEDS,
  CYCLES,
  FARM,
  LOTS,
  required,
  TAGS,
  USERS,
  VACCINES,
  type Catalog,
} from './catalog.js';
import type { SeedClient } from './client.js';
import type { Economics } from './economics.js';
import type { Herd, SeedAnimal, SeedPregnancy } from './herd.js';
import type { History } from './history.js';
import { derivedId, instantOf } from './ids.js';

/** Filas por lote en las inserciones masivas. */
const CHUNK = 500;

/** `IsoDate` → `Date` de medianoche UTC, que es como Prisma representa una columna `date`. */
function day(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dayOrNull(date: IsoDate | null): Date | null {
  return date === null ? null : day(date);
}

async function inChunks<T>(
  rows: readonly T[],
  write: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < rows.length; index += CHUNK) {
    await write(rows.slice(index, index + CHUNK));
  }
}

/**
 * Borra los datos de una finca en orden inverso de dependencia.
 *
 * Es un borrado **físico**, y es la única excepción legítima a RN-11: no está borrando datos
 * de negocio, está rehaciendo un juego de datos de demostración. Por eso vive en el seed y no
 * en la API, y por eso las guardas no lo dejan correr contra una base que no sea local.
 */
export async function resetFarmData(
  prisma: SeedClient,
  farmId: string,
  usernames: readonly string[] = USERS.map((user) => user.username),
): Promise<void> {
  const animals = await prisma.animal.findMany({ where: { farmId }, select: { id: true } });
  const animalIds = animals.map((animal) => animal.id);
  const where = { animalId: { in: animalIds } };

  await prisma.auditLog.deleteMany({ where: { farmId } });
  await prisma.idempotencyKey.deleteMany({ where: { farmId } });
  await prisma.workSessionEntry.deleteMany({ where });
  await prisma.expenseAllocation.deleteMany({ where: { farmId } });
  await prisma.expense.deleteMany({ where: { farmId } });
  await prisma.sale.deleteMany({ where: { farmId } });
  await prisma.valuation.deleteMany({ where: { farmId } });
  await prisma.lotMovement.deleteMany({ where: { farmId } });
  await prisma.weightRecord.deleteMany({ where: { farmId } });
  await prisma.treatmentRecord.deleteMany({ where: { farmId } });
  await prisma.vaccinationRecord.deleteMany({ where: { farmId } });
  await prisma.identifier.deleteMany({ where: { farmId } });
  await prisma.animalTag.deleteMany({ where });
  // La importación de la báscula apunta a su jornada de pesaje (M6).
  await prisma.importBatch.deleteMany({ where: { farmId } });
  await prisma.workSession.deleteMany({ where: { farmId } });
  await prisma.scaleProfile.deleteMany({ where: { farmId } });
  // Primero se sueltan las referencias cruzadas entre animales y preñeces.
  await prisma.animal.updateMany({
    where: { farmId },
    data: { birthPregnancyId: null, birthCondition: null, damId: null, sireId: null },
  });
  await prisma.pregnancy.deleteMany({ where: { farmId } });
  await prisma.animal.deleteMany({ where: { farmId } });
  await prisma.vaccinationCycleVaccine.deleteMany({ where: { farmId } });
  await prisma.vaccinationCycle.deleteMany({ where: { farmId } });
  await prisma.vaccine.deleteMany({ where: { farmId } });
  await prisma.lot.deleteMany({ where: { farmId } });
  await prisma.tag.deleteMany({ where: { farmId } });
  await prisma.breed.deleteMany({ where: { farmId } });
  // Sesiones e intentos de inicio de sesión de los usuarios de demostración: sin esto, el seed
  // no se podía repetir después de que alguien entrara (la clave foránea de refresh_tokens
  // impedía borrar los usuarios) y un bloqueo por intentos sobrevivía a la resiembra.
  await prisma.refreshToken.deleteMany({
    where: { OR: [{ farmId }, { user: { username: { in: [...usernames] } } }] },
  });
  await prisma.loginAttempt.deleteMany({ where: { login: { in: [...usernames] } } });
  await prisma.membership.deleteMany({ where: { farmId } });
  await prisma.farm.deleteMany({ where: { id: farmId } });
  await prisma.user.deleteMany({ where: { username: { in: [...usernames] } } });
}

/** Datos completos por escribir. */
export type SeedPayload = {
  readonly catalog: Catalog;
  readonly herd: Herd;
  readonly history: History;
  readonly economics: Economics;
  readonly passwordHash: string;
  readonly today: IsoDate;
};

/** Escribe la finca entera. Devuelve cuántas filas quedaron por tabla. */
export async function writeSeed(
  prisma: SeedClient,
  payload: SeedPayload,
): Promise<Record<string, number>> {
  const { catalog, herd, history, economics, passwordHash, today } = payload;
  const farmId = catalog.farmId;
  const author = catalog.authorId;
  const createdAt = instantOf(today);

  await prisma.farm.create({
    data: {
      id: farmId,
      name: FARM.name,
      municipality: FARM.municipality,
      department: FARM.department,
      icaPremiseCode: FARM.icaPremiseCode,
      settings: catalog.settings,
      createdAt,
      updatedAt: createdAt,
    },
  });

  await prisma.user.createMany({
    data: catalog.users.map(({ id, user }) => ({
      id,
      name: user.name,
      username: user.username,
      email: user.email,
      passwordHash,
      // Los usuarios de demostración no tienen que cambiar la contraseña al entrar: es una
      // finca de prueba y el flujo de cambio obligatorio se prueba aparte en M1.
      mustChangePassword: false,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    })),
  });

  await prisma.membership.createMany({
    data: catalog.users.map(({ id, membershipId, user }) => ({
      id: membershipId,
      userId: id,
      farmId,
      role: user.role,
      isActive: true,
    })),
  });

  await prisma.breed.createMany({
    data: BREEDS.map((breed) => ({
      id: required(catalog.breedIds, breed.name, 'la raza'),
      farmId,
      name: breed.name,
      group: breed.group,
      gestationDays: catalog.breedGestationDays.get(breed.name) ?? null,
      isActive: true,
      updatedAt: createdAt,
    })),
  });

  await prisma.vaccine.createMany({
    data: VACCINES.map((vaccine) => ({
      id: required(catalog.vaccineIds, vaccine.key, 'la vacuna'),
      farmId,
      name: vaccine.name,
      disease: vaccine.disease,
      defaultDose: vaccine.defaultDose,
      route: vaccine.route,
      scheduleType: vaccine.scheduleType,
      boosterIntervalDays: vaccine.boosterIntervalDays,
      eligibleSex: vaccine.eligibleSex,
      minAgeDays: vaccine.minAgeDays,
      maxAgeDays: vaccine.maxAgeDays,
      blockIneligibleSex: vaccine.blockIneligibleSex,
      isActive: true,
      updatedAt: createdAt,
    })),
  });

  await prisma.vaccinationCycle.createMany({
    data: CYCLES.map((cycle) => ({
      id: required(catalog.cycleIds, cycle.name, 'el ciclo'),
      farmId,
      name: cycle.name,
      startsOn: day(cycle.startsOn),
      endsOn: day(cycle.endsOn),
      isOfficial: true,
      createdAt,
      updatedAt: createdAt,
    })),
  });

  await prisma.vaccinationCycleVaccine.createMany({
    data: CYCLES.flatMap((cycle) =>
      VACCINES.filter((vaccine) => vaccine.inOfficialCycle).map((vaccine) => ({
        id: derivedId(`cycle-vaccine:${cycle.name}:${vaccine.key}`, today),
        farmId,
        cycleId: required(catalog.cycleIds, cycle.name, 'el ciclo'),
        vaccineId: required(catalog.vaccineIds, vaccine.key, 'la vacuna'),
        createdAt,
        updatedAt: createdAt,
      })),
    ),
  });

  await prisma.lot.createMany({
    data: LOTS.map((lot) => ({
      id: required(catalog.lotIds, lot.key, 'el lote'),
      farmId,
      name: lot.name,
      description: lot.description,
      isActive: true,
      updatedAt: createdAt,
    })),
  });

  await prisma.tag.createMany({
    data: TAGS.map((tag) => ({
      id: required(catalog.tagIds, tag.key, 'la etiqueta'),
      farmId,
      key: tag.key,
      label: tag.label,
      description: tag.description,
      updatedAt: createdAt,
      isSystem: tag.isSystem,
    })),
  });

  // --- Animales y preñeces, en orden de dependencias (ver el punto 1 de arriba) ---
  const byBirth = [...herd.animals].sort(
    (a, b) => compareIsoDates(a.birthDate, b.birthDate) || a.id.localeCompare(b.id),
  );
  const pregnancyById = new Map(herd.pregnancies.map((pregnancy) => [pregnancy.id, pregnancy]));
  const writtenAnimals = new Set<string>();
  const writtenPregnancies = new Set<string>();
  let pendingAnimals: SeedAnimal[] = [];
  let pendingPregnancies: SeedPregnancy[] = [];

  const writePending = async (): Promise<void> => {
    await inChunks(pendingPregnancies, (chunk) =>
      prisma.pregnancy.createMany({ data: chunk.map((pregnancy) => pregnancyRow(pregnancy)) }),
    );
    await inChunks(pendingAnimals, (chunk) =>
      prisma.animal.createMany({ data: chunk.map((animal) => animalRow(animal)) }),
    );
    for (const pregnancy of pendingPregnancies) writtenPregnancies.add(pregnancy.id);
    for (const animal of pendingAnimals) writtenAnimals.add(animal.id);
    pendingAnimals = [];
    pendingPregnancies = [];
  };
  const written = (id: string | null): boolean => id === null || writtenAnimals.has(id);

  for (const animal of byBirth) {
    const pregnancy =
      animal.birthPregnancyId === null ? undefined : pregnancyById.get(animal.birthPregnancyId);
    const ready =
      written(animal.damId) &&
      written(animal.sireId) &&
      (pregnancy === undefined || (written(pregnancy.damId) && written(pregnancy.sireId)));
    if (!ready) await writePending();
    if (
      pregnancy !== undefined &&
      !writtenPregnancies.has(pregnancy.id) &&
      !pendingPregnancies.includes(pregnancy)
    ) {
      pendingPregnancies.push(pregnancy);
    }
    pendingAnimals.push(animal);
  }
  await writePending();
  pendingPregnancies = herd.pregnancies.filter(
    (pregnancy) => !writtenPregnancies.has(pregnancy.id),
  );
  await writePending();

  function animalRow(animal: SeedAnimal) {
    return {
      id: animal.id,
      farmId,
      code: animal.code,
      name: animal.name,
      sex: animal.sex,
      breedId: required(catalog.breedIds, animal.breedName, 'la raza'),
      birthDate: day(animal.birthDate),
      birthDateEstimated: animal.birthDateEstimated,
      origin: animal.origin,
      originDetail: animal.originDetail,
      entryDate: day(animal.entryDate),
      damId: animal.damId,
      sireId: animal.sireId,
      birthPregnancyId: animal.birthPregnancyId,
      lotId: required(catalog.lotIds, animal.lotKey, 'el lote'),
      forSale: animal.forSale,
      exitType: animal.exitType,
      exitDate: dayOrNull(animal.exitDate),
      exitReason: animal.exitReason,
      notes: animal.notes,
      version: 1,
      createdById: author,
      updatedById: author,
      createdAt: instantOf(animal.entryDate),
      updatedAt: instantOf(animal.exitDate ?? animal.entryDate),
    };
  }

  function pregnancyRow(pregnancy: SeedPregnancy) {
    return {
      id: pregnancy.id,
      farmId,
      damId: pregnancy.damId,
      serviceDate: day(pregnancy.serviceDate),
      serviceDateEstimated: pregnancy.serviceDateEstimated,
      method: pregnancy.method,
      sireId: pregnancy.sireId,
      sireExternalRef: pregnancy.sireExternalRef,
      confirmedAt: dayOrNull(pregnancy.confirmedAt),
      expectedCalvingDate: day(pregnancy.expectedCalvingDate),
      outcome: pregnancy.outcome,
      outcomeDate: dayOrNull(pregnancy.outcomeDate),
      calvingType: pregnancy.calvingType,
      stillbornCount: pregnancy.stillbornCount,
      isImported: pregnancy.isImported,
      responsible: pregnancy.responsible,
      notes: pregnancy.notes,
      version: 1,
      createdById: author,
      updatedById: author,
      createdAt: instantOf(pregnancy.serviceDate),
      updatedAt: instantOf(pregnancy.outcomeDate ?? pregnancy.serviceDate),
    };
  }

  await prisma.animalTag.createMany({
    data: herd.animals.flatMap((animal) =>
      animal.tagKeys.map((key) => ({
        id: derivedId(`animal-tag:${animal.id}:${key}`, animal.entryDate),
        farmId,
        animalId: animal.id,
        tagId: required(catalog.tagIds, key, 'la etiqueta'),
        createdById: author,
        createdAt: instantOf(animal.entryDate),
        updatedAt: instantOf(animal.entryDate),
      })),
    ),
  });

  await inChunks(history.identifiers, (chunk) =>
    prisma.identifier.createMany({
      data: chunk.map((identifier) => ({
        id: identifier.id,
        farmId,
        animalId: identifier.animalId,
        type: identifier.type,
        value: identifier.value,
        assignedAt: day(identifier.assignedAt),
        createdAt: instantOf(identifier.assignedAt),
        updatedAt: instantOf(identifier.assignedAt),
      })),
    }),
  );

  await prisma.workSession.createMany({
    data: history.workSessions.map((session) => ({
      id: session.id,
      farmId,
      name: session.name,
      sessionDate: day(session.sessionDate),
      activities: session.activities,
      status: 'CLOSED' as const,
      closedAt: instantOf(session.sessionDate),
      createdById: author,
      createdAt: instantOf(session.sessionDate),
      updatedAt: instantOf(session.sessionDate),
    })),
  });

  const sessionIds = new Map(history.workSessions.map((session) => [session.key, session.id]));

  await inChunks(history.vaccinations, (chunk) =>
    prisma.vaccinationRecord.createMany({
      data: chunk.map((record) => ({
        id: record.id,
        farmId,
        animalId: record.animalId,
        vaccineId: required(catalog.vaccineIds, record.vaccineKey, 'la vacuna'),
        appliedOn: day(record.appliedOn),
        dose: record.dose,
        batchNumber: record.batchNumber,
        ruvNumber: record.ruvNumber,
        cycleId:
          record.cycleName === null ? null : (catalog.cycleIds.get(record.cycleName) ?? null),
        responsible: record.responsible,
        nextDueOn: dayOrNull(record.nextDueOn),
        workSessionId:
          record.workSessionKey === null ? null : (sessionIds.get(record.workSessionKey) ?? null),
        createdById: author,
        createdAt: instantOf(record.appliedOn),
        updatedAt: instantOf(record.appliedOn),
      })),
    }),
  );

  await inChunks(history.weights, (chunk) =>
    prisma.weightRecord.createMany({
      data: chunk.map((record) => ({
        id: record.id,
        farmId,
        animalId: record.animalId,
        weighedOn: day(record.weighedOn),
        weightKg: record.weightKg,
        method: record.method,
        isBirthWeight: record.isBirthWeight,
        workSessionId:
          record.workSessionKey === null ? null : (sessionIds.get(record.workSessionKey) ?? null),
        createdById: author,
        createdAt: instantOf(record.weighedOn),
        updatedAt: instantOf(record.weighedOn),
      })),
    }),
  );

  await prisma.treatmentRecord.createMany({
    data: history.treatments.map((record) => ({
      id: record.id,
      farmId,
      animalId: record.animalId,
      startedOn: day(record.startedOn),
      reason: record.reason,
      medication: record.medication,
      dose: record.dose,
      durationDays: record.durationDays,
      withdrawalMeatDays: record.withdrawalMeatDays,
      withdrawalMilkDays: record.withdrawalMilkDays,
      withdrawalUntil: day(record.withdrawalUntil),
      responsible: record.responsible,
      createdById: author,
      createdAt: instantOf(record.startedOn),
      updatedAt: instantOf(record.startedOn),
    })),
  });

  await inChunks(history.lotMovements, (chunk) =>
    prisma.lotMovement.createMany({
      data: chunk.map((movement) => ({
        id: movement.id,
        farmId,
        animalId: movement.animalId,
        fromLotId: null,
        toLotId: required(catalog.lotIds, movement.toLotKey, 'el lote'),
        movedOn: day(movement.movedOn),
        createdById: author,
        createdAt: instantOf(movement.movedOn),
        updatedAt: instantOf(movement.movedOn),
      })),
    }),
  );

  await prisma.expense.createMany({
    data: economics.expenses.map((expense) => ({
      id: expense.id,
      farmId,
      type: expense.type,
      occurredOn: day(expense.occurredOn),
      amount: expense.amount,
      description: expense.description,
      allocationMethod: expense.allocationMethod,
      createdById: author,
      updatedById: author,
      createdAt: instantOf(expense.occurredOn),
      updatedAt: instantOf(expense.occurredOn),
    })),
  });

  await inChunks(
    economics.expenses.flatMap((expense) =>
      expense.allocations.map((allocation) => ({
        expenseId: expense.id,
        occurredOn: expense.occurredOn,
        ...allocation,
      })),
    ),
    (chunk) =>
      prisma.expenseAllocation.createMany({
        data: chunk.map((allocation) => ({
          id: allocation.id,
          farmId,
          expenseId: allocation.expenseId,
          animalId: allocation.animalId,
          amount: allocation.amount,
          createdAt: instantOf(allocation.occurredOn),
          updatedAt: instantOf(allocation.occurredOn),
        })),
      }),
  );

  await prisma.sale.createMany({
    data: economics.sales.map((sale) => ({
      id: sale.id,
      farmId,
      animalId: sale.animalId,
      soldOn: day(sale.soldOn),
      amount: sale.amount,
      buyer: sale.buyer,
      notes: sale.notes,
      createdById: author,
      updatedById: author,
      createdAt: instantOf(sale.soldOn),
      updatedAt: instantOf(sale.soldOn),
    })),
  });

  await prisma.valuation.createMany({
    data: economics.valuations.map((valuation) => ({
      id: valuation.id,
      farmId,
      animalId: valuation.animalId,
      valuedOn: day(valuation.valuedOn),
      amount: valuation.amount,
      method: valuation.method,
      createdById: author,
      createdAt: instantOf(valuation.valuedOn),
      updatedAt: instantOf(valuation.valuedOn),
    })),
  });

  return {
    animales: herd.animals.length,
    preñeces: herd.pregnancies.length,
    identificadores: history.identifiers.length,
    vacunaciones: history.vaccinations.length,
    pesajes: history.weights.length,
    tratamientos: history.treatments.length,
    'movimientos de lote': history.lotMovements.length,
    jornadas: history.workSessions.length,
    gastos: economics.expenses.length,
    asignaciones: economics.expenses.reduce((sum, expense) => sum + expense.allocations.length, 0),
    ventas: economics.sales.length,
    avalúos: economics.valuations.length,
  };
}
