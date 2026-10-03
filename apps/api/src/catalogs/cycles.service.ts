import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  cycleDatesError,
  DomainError,
  formatDate,
  rangesOverlap,
  uuidv7,
  warning,
  type CatalogList,
  type CreateCycleInput,
  type CycleView,
  type IsoDate,
  type UpdateCycleInput,
  type Warning,
  type WithWarnings,
} from '@hato/shared';

import { userOf } from '../animals/animal-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { scopedWhere } from '../common/scoped-prisma.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  assertVersion,
  audit,
  catalogReplay,
  catalogWrite,
  changesBetween,
  type Tx,
} from './catalog-support.js';

const FIELDS = ['name', 'startsOn', 'endsOn', 'isOfficial', 'isActive', 'vaccineIds'] as const;

/** Las vacunas vigentes del ciclo: las quitadas quedan como historial (ADR-012, M6). */
const WITH_VACCINES = {
  vaccines: {
    where: { removedAt: null },
    include: { vaccine: { select: { id: true, name: true } } },
  },
} as const;

type CycleRow = {
  id: string;
  name: string;
  startsOn: Date;
  endsOn: Date;
  isOfficial: boolean;
  isActive: boolean;
  version: number;
  vaccines: { vaccine: { id: string; name: string } }[];
};

/** Ciclos oficiales de vacunación y sus vacunas (SAN-06). Solo ADMIN escribe. */
@Injectable()
export class CyclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(scope: FarmScope, includeInactive: boolean): Promise<CatalogList<CycleView>> {
    const rows = await this.prisma.vaccinationCycle.findMany({
      where: scopedWhere(scope, includeInactive ? {} : { isActive: true }),
      include: WITH_VACCINES,
      orderBy: { startsOn: 'desc' },
    });
    return { items: rows.map(toView), nextCursor: null };
  }

  /** Crea un ciclo. Si se cruza con otro ciclo activo, se guarda y se advierte. */
  async create(scope: FarmScope, input: CreateCycleInput): Promise<WithWarnings<CycleView>> {
    if (input.id !== undefined) {
      const replay = catalogReplay(
        await this.prisma.vaccinationCycle.findUnique({
          where: { id: input.id },
          include: WITH_VACCINES,
        }),
        scope.farmId,
        {
          name: input.name,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          isOfficial: input.isOfficial ?? true,
          vaccineIds: [...input.vaccineIds].sort(),
        },
        (row): WithWarnings<CycleView> => ({ ...toView(row), warnings: [] }),
        (view) => ({ ...view, vaccineIds: view.vaccines.map((vaccine) => vaccine.id).sort() }),
      );
      if (replay !== null) return replay;
    }
    return catalogWrite('VaccinationCycle', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        await assertVaccinesOfFarm(tx, scope, input.vaccineIds);
        const id = input.id ?? uuidv7();
        const at = this.clock.now();
        await tx.vaccinationCycle.create({
          data: {
            id,
            farmId: scope.farmId,
            name: input.name,
            startsOn: toPrismaDate(input.startsOn),
            endsOn: toPrismaDate(input.endsOn),
            isOfficial: input.isOfficial ?? true,
            vaccines: {
              create: input.vaccineIds.map((vaccineId) => ({
                id: uuidv7(),
                farmId: scope.farmId,
                vaccineId,
                createdAt: at,
                updatedAt: at,
              })),
            },
          },
        });
        const cycle = toView(await findCycle(tx, scope, id));
        await audit(tx, {
          scope,
          entity: 'VaccinationCycle',
          entityId: id,
          action: AUDIT_ACTION.CREATE,
          at,
          diff: { after: auditable(cycle) },
        });
        return { ...cycle, warnings: await overlapWarnings(tx, scope, cycle) };
      }),
    );
  }

  async update(
    scope: FarmScope,
    id: string,
    input: UpdateCycleInput,
  ): Promise<WithWarnings<CycleView>> {
    return catalogWrite('VaccinationCycle', input.name, () =>
      this.prisma.$transaction(async (tx) => {
        const before = toView(
          assertVersion(
            await tx.vaccinationCycle.findFirst({
              where: scopedWhere(scope, { id }),
              include: WITH_VACCINES,
            }),
            input.version,
          ),
        );
        const startsOn: IsoDate = input.startsOn ?? before.startsOn;
        const endsOn: IsoDate = input.endsOn ?? before.endsOn;
        const datesError = cycleDatesError(startsOn, endsOn);
        if (datesError !== null) {
          throw new DomainError('VALIDATION_FAILED', { fieldErrors: { endsOn: [datesError] } });
        }
        if (input.vaccineIds !== undefined) {
          await assertVaccinesOfFarm(tx, scope, input.vaccineIds);
          await replaceCycleVaccines(tx, scope, id, before, input.vaccineIds, this.clock.now());
        }
        await tx.vaccinationCycle.update({
          where: { id, version: input.version },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            startsOn: toPrismaDate(startsOn),
            endsOn: toPrismaDate(endsOn),
            ...(input.isOfficial === undefined ? {} : { isOfficial: input.isOfficial }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            version: { increment: 1 },
          },
        });
        const after = toView(await findCycle(tx, scope, id));
        await audit(tx, {
          scope,
          entity: 'VaccinationCycle',
          entityId: id,
          action: AUDIT_ACTION.UPDATE,
          at: this.clock.now(),
          diff: changesBetween(auditable(before), auditable(after), FIELDS),
        });
        const warnings = after.isActive ? await overlapWarnings(tx, scope, after) : [];
        return { ...after, warnings };
      }),
    );
  }
}

/**
 * Deja en el ciclo exactamente las vacunas pedidas sin borrar filas (ADR-012): las que salen
 * quedan con `removed_at`, las que entran se crean y las que siguen no se tocan. Volver a poner
 * una vacuna quitada crea otra fila, como `animal_tags`.
 */
async function replaceCycleVaccines(
  tx: Tx,
  scope: FarmScope,
  cycleId: string,
  before: CycleView,
  vaccineIds: readonly string[],
  at: Date,
): Promise<void> {
  const current = new Set(before.vaccines.map((vaccine) => vaccine.id));
  const wanted = new Set(vaccineIds);
  const removed = [...current].filter((vaccineId) => !wanted.has(vaccineId));
  const added = [...wanted].filter((vaccineId) => !current.has(vaccineId));

  if (removed.length > 0) {
    await tx.vaccinationCycleVaccine.updateMany({
      where: { farmId: scope.farmId, cycleId, vaccineId: { in: removed }, removedAt: null },
      data: { removedAt: at, removedById: userOf(scope) },
    });
  }
  if (added.length > 0) {
    await tx.vaccinationCycleVaccine.createMany({
      data: added.map((vaccineId) => ({
        id: uuidv7(),
        farmId: scope.farmId,
        cycleId,
        vaccineId,
        createdAt: at,
        updatedAt: at,
      })),
    });
  }
}

async function findCycle(tx: Tx, scope: FarmScope, id: string): Promise<CycleRow> {
  return tx.vaccinationCycle.findFirstOrThrow({
    where: scopedWhere(scope, { id }),
    include: WITH_VACCINES,
  });
}

/**
 * Las vacunas del ciclo tienen que ser de esta finca. Se aceptan también las desactivadas: un
 * ciclo antiguo puede conservar una vacuna que ya no se usa.
 */
async function assertVaccinesOfFarm(tx: Tx, scope: FarmScope, ids: readonly string[]) {
  const found = await tx.vaccine.count({ where: scopedWhere(scope, { id: { in: [...ids] } }) });
  if (found !== ids.length) {
    throw new DomainError('VALIDATION_FAILED', {
      fieldErrors: { vaccineIds: ['Alguna de las vacunas elegidas no existe en esta finca.'] },
    });
  }
}

/** Otros ciclos activos cuyas fechas se cruzan con este (SAN-06): se advierte, no se bloquea. */
async function overlapWarnings(tx: Tx, scope: FarmScope, cycle: CycleView): Promise<Warning[]> {
  const others = await tx.vaccinationCycle.findMany({
    where: scopedWhere(scope, { isActive: true, id: { not: cycle.id } }),
    orderBy: { startsOn: 'asc' },
  });
  return others
    .map((other) => ({
      name: other.name,
      startsOn: fromPrismaDate(other.startsOn),
      endsOn: fromPrismaDate(other.endsOn),
    }))
    .filter((other) => rangesOverlap(cycle, other))
    .map((other) =>
      warning('CYCLE_OVERLAP', {
        name: other.name,
        from: formatDate(other.startsOn),
        to: formatDate(other.endsOn),
      }),
    );
}

/** Forma para la auditoría: las vacunas como lista de ids ordenada. */
function auditable(cycle: CycleView) {
  return {
    name: cycle.name,
    startsOn: cycle.startsOn,
    endsOn: cycle.endsOn,
    isOfficial: cycle.isOfficial,
    isActive: cycle.isActive,
    vaccineIds: cycle.vaccines.map((vaccine) => vaccine.id).sort(),
  };
}

function toView(cycle: CycleRow): CycleView {
  return {
    id: cycle.id,
    name: cycle.name,
    startsOn: fromPrismaDate(cycle.startsOn),
    endsOn: fromPrismaDate(cycle.endsOn),
    isOfficial: cycle.isOfficial,
    isActive: cycle.isActive,
    version: cycle.version,
    vaccines: cycle.vaccines
      .map(({ vaccine }) => ({ id: vaccine.id, name: vaccine.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es-CO')),
  };
}
