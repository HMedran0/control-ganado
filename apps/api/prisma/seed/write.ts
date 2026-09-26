/**
 * Escritura del hato en la base de datos.
 *
 * Tres cosas que no son obvias:
 *
 * 1. **Orden y ciclo de referencias.** `animals.birth_pregnancy_id` apunta a `pregnancies` y
 *    `pregnancies.dam_id` apunta a `animals`: el ciclo se rompe insertando los animales sin
 *    esa columna, luego las preñeces, y actualizando al final. Los animales se insertan en
 *    orden de nacimiento para que la madre y el padre ya existan cuando llega la cría.
 * 2. **Marcas de tiempo deterministas.** `created_at` y `updated_at` se escriben a mano, a
 *    partir de la fecha del hecho, en lugar de dejar el `now()` de la base. Sin eso, dos
 *    ejecuciones del seed no darían un volcado idéntico y no se podría comprobar el
 *    determinismo comparando la base entera.
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
import type { Herd } from './herd.js';
import type { History } from './history.js';
import { instantOf } from './ids.js';
import { Prisma } from '../../src/generated/prisma/client.js';

/** Filas por lote en las inserciones masivas. */
const CHUNK = 500;

/** `IsoDate` → `Date` de medianoche UTC, que es como Prisma representa una columna `date`. */
function day(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dayOrNull(date: IsoDate | null): Date | null {
  return date === null ? null : day(date);
}

async function inChunks<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
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
  await prisma.workSession.deleteMany({ where: { farmId } });
  // Primero se sueltan las referencias cruzadas entre animales y preñeces.
  await prisma.animal.updateMany({
    where: { farmId },
    data: { birthPregnancyId: null, damId: null, sireId: null },
  });
  await prisma.pregnancy.deleteMany({ where: { farmId } });
  await prisma.animal.deleteMany({ where: { farmId } });
  await prisma.vaccinationCycleVaccine.deleteMany({
    where: { cycle: { farmId } },
  });
  await prisma.vaccinationCycle.deleteMany({ where: { farmId } });
  await prisma.vaccine.deleteMany({ where: { farmId } });
  await prisma.lot.deleteMany({ where: { farmId } });
  await prisma.tag.deleteMany({ where: { farmId } });
  await prisma.breed.deleteMany({ where: { farmId } });
  await prisma.importBatch.deleteMany({ where: { farmId } });
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
    })),
  });

  await prisma.vaccinationCycleVaccine.createMany({
    data: CYCLES.flatMap((cycle) =>
      VACCINES.filter((vaccine) => vaccine.inOfficialCycle).map((vaccine) => ({
        cycleId: required(catalog.cycleIds, cycle.name, 'el ciclo'),
        vaccineId: required(catalog.vaccineIds, vaccine.key, 'la vacuna'),
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
    })),
  });

  await prisma.tag.createMany({
    data: TAGS.map((tag) => ({
      id: required(catalog.tagIds, tag.key, 'la etiqueta'),
      farmId,
      key: tag.key,
      label: tag.label,
      isSystem: tag.isSystem,
    })),
  });

  // --- Animales, en orden de nacimiento para que madre y padre ya existan ---
  const byBirth = [...herd.animals].sort(
    (a, b) => compareIsoDates(a.birthDate, b.birthDate) || a.id.localeCompare(b.id),
  );

  await inChunks(byBirth, (chunk) =>
    prisma.animal.createMany({
      data: chunk.map((animal) => ({
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
        // Se completa después de insertar las preñeces: la referencia es circular.
        birthPregnancyId: null,
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
      })),
    }),
  );

  await inChunks(herd.pregnancies, (chunk) =>
    prisma.pregnancy.createMany({
      data: chunk.map((pregnancy) => ({
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
      })),
    }),
  );

  // Cierre del ciclo de referencias: qué preñez trajo a cada cría (RN-05).
  const born = herd.animals.filter((animal) => animal.birthPregnancyId !== null);
  for (let index = 0; index < born.length; index += CHUNK) {
    const chunk = born.slice(index, index + CHUNK);
    const values = Prisma.join(
      chunk.map(
        (animal) =>
          Prisma.sql`(${animal.id}::uuid, ${animal.birthPregnancyId ?? ''}::uuid)`,
      ),
    );
    await prisma.$executeRaw`
      UPDATE animals AS a
      SET birth_pregnancy_id = v.pregnancy_id
      FROM (VALUES ${values}) AS v(animal_id, pregnancy_id)
      WHERE a.id = v.animal_id`;
  }

  await prisma.animalTag.createMany({
    data: herd.animals.flatMap((animal) =>
      animal.tagKeys.map((key) => ({
        animalId: animal.id,
        tagId: required(catalog.tagIds, key, 'la etiqueta'),
        createdById: author,
        createdAt: instantOf(animal.entryDate),
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
        cycleId: record.cycleName === null ? null : catalog.cycleIds.get(record.cycleName) ?? null,
        responsible: record.responsible,
        nextDueOn: dayOrNull(record.nextDueOn),
        workSessionId:
          record.workSessionKey === null ? null : sessionIds.get(record.workSessionKey) ?? null,
        createdById: author,
        createdAt: instantOf(record.appliedOn),
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
          record.workSessionKey === null ? null : sessionIds.get(record.workSessionKey) ?? null,
        createdById: author,
        createdAt: instantOf(record.weighedOn),
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
      createdAt: instantOf(expense.occurredOn),
    })),
  });

  await inChunks(
    economics.expenses.flatMap((expense) =>
      expense.allocations.map((allocation) => ({ expenseId: expense.id, ...allocation })),
    ),
    (chunk) =>
      prisma.expenseAllocation.createMany({
        data: chunk.map((allocation) => ({
          id: allocation.id,
          farmId,
          expenseId: allocation.expenseId,
          animalId: allocation.animalId,
          amount: allocation.amount,
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
      createdAt: instantOf(sale.soldOn),
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
    asignaciones: economics.expenses.reduce(
      (sum, expense) => sum + expense.allocations.length,
      0,
    ),
    ventas: economics.sales.length,
    avalúos: economics.valuations.length,
  };
}
