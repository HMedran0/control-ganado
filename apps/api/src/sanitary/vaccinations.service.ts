import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  VACCINE_SCHEDULE_TYPE,
  bulkVaccinationDecision,
  canApplyVaccine,
  cycleContaining,
  nextDueOnFromInterval,
  uuidv7,
  vaccineSexBlockedParams,
  type AnimalRef,
  type BulkVaccinationInput,
  type BulkVaccinationResult,
  type BulkVaccinationSkipped,
  type CreateVaccinationInput,
  type CycleProgressView,
  type IsoDate,
  type ListVaccinationsQuery,
  type VaccinationList,
  type VaccinationView,
  type VaccinationWithWarnings,
  type VaccineSchedule,
  type VoidEventInput,
  type Warning,
} from '@hato/shared';

import { AnimalListService } from '../animals/animal-list.service.js';
import { fieldError, userOf } from '../animals/animal-rules.js';
import { classificationCtes } from '../animals/classification.sql.js';
import {
  FarmContextService,
  classificationParams,
  type FarmContext,
} from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  asReplayed,
  assertSameContent,
  ownRecordOrConflict,
} from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import { audit, type Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, fromPrismaDateOrNull, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { animalRef, assertEventDate, lockEventAnimal } from './event-rules.js';

const include = {
  animal: { select: { id: true, code: true, name: true } },
  vaccine: { select: { id: true, name: true } },
  cycle: { select: { id: true, name: true } },
} as const satisfies Prisma.VaccinationRecordInclude;

type VaccinationRow = Prisma.VaccinationRecordGetPayload<{ include: typeof include }>;

type VaccineRow = Prisma.VaccineGetPayload<object>;

function toView(row: VaccinationRow): VaccinationView {
  return {
    id: row.id,
    animal: row.animal,
    vaccine: row.vaccine,
    appliedOn: fromPrismaDate(row.appliedOn),
    dose: row.dose,
    batchNumber: row.batchNumber,
    ruvNumber: row.ruvNumber,
    cycle: row.cycle,
    responsible: row.responsible,
    nextDueOn: fromPrismaDateOrNull(row.nextDueOn),
    notes: row.notes,
    workSessionId: row.workSessionId,
    voided:
      row.voidedAt === null ? null : { at: row.voidedAt.toISOString(), reason: row.voidReason },
    createdAt: row.createdAt.toISOString(),
  };
}

function scheduleOf(vaccine: VaccineRow): VaccineSchedule {
  return {
    scheduleType: vaccine.scheduleType,
    boosterIntervalDays: vaccine.boosterIntervalDays,
    eligibleSex: vaccine.eligibleSex,
    minAgeDays: vaccine.minAgeDays,
    maxAgeDays: vaccine.maxAgeDays,
    blockIneligibleSex: vaccine.blockIneligibleSex,
  };
}

/** Máximo de animales en una vacunación por lote elegida con filtros. */
const BULK_FILTER_MAX = 5000;

/**
 * Vacunaciones (SAN-02, SAN-03, SAN-06; RN-12, RN-13, RN-14, RN-26). Todos los roles registran;
 * anular es de ADMIN y VET. Toda escritura bloquea el animal (o los animales) en su transacción y
 * deja su auditoría en ella.
 */
@Injectable()
export class VaccinationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly farmContext: FarmContextService,
    private readonly transactions: TransactionsService,
    private readonly animalList: AnimalListService,
  ) {}

  async list(scope: FarmScope, query: ListVaccinationsQuery): Promise<VaccinationList> {
    const { limit, cursor } = parsePagination(query);
    const rows = await this.prisma.vaccinationRecord.findMany({
      where: {
        farmId: scope.farmId,
        ...(query.animalId === undefined ? {} : { animalId: query.animalId }),
        ...(query.vaccineId === undefined ? {} : { vaccineId: query.vaccineId }),
        ...(query.from === undefined && query.to === undefined
          ? {}
          : {
              appliedOn: {
                ...(query.from === undefined ? {} : { gte: toPrismaDate(query.from) }),
                ...(query.to === undefined ? {} : { lte: toPrismaDate(query.to) }),
              },
            }),
        ...(cursor === null ? {} : { id: { lt: String(cursor.id) } }),
      },
      include,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toView),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor({ id: last.id }) : null,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Individual (SAN-02)
  // -------------------------------------------------------------------------------------------

  async create(scope: FarmScope, input: CreateVaccinationInput): Promise<VaccinationWithWarnings> {
    if (input.id !== undefined) {
      const existing = ownRecordOrConflict(
        await this.prisma.vaccinationRecord.findUnique({ where: { id: input.id }, include }),
        scope.farmId,
      );
      if (existing !== null) {
        assertSameContent(
          {
            animalId: input.animalId,
            vaccineId: input.vaccineId,
            appliedOn: input.date,
            // Sin dosis, se guardó la de la vacuna: solo se compara la que el cliente envió.
            dose: input.dose,
            batchNumber: input.batchNumber ?? null,
            ruvNumber: input.ruvNumber ?? null,
            responsible: input.responsible ?? null,
            notes: input.notes ?? null,
          },
          {
            animalId: existing.animalId,
            vaccineId: existing.vaccineId,
            appliedOn: fromPrismaDate(existing.appliedOn),
            dose: existing.dose,
            batchNumber: existing.batchNumber,
            ruvNumber: existing.ruvNumber,
            responsible: existing.responsible,
            notes: existing.notes,
          },
        );
        return asReplayed({ ...toView(existing), warnings: [] });
      }
    }

    const context = await this.farmContext.load(scope);
    const at = this.clock.now();
    const userId = userOf(scope);

    return this.transactions.run(async (tx) => {
      const animal = await lockEventAnimal(tx, scope, input.animalId);
      assertEventDate(input.date, animal, context.today);
      const vaccine = await this.vaccineOf(tx, scope, input.vaccineId);
      const schedule = scheduleOf(vaccine);

      const check = canApplyVaccine({
        vaccine: schedule,
        animal,
        vaccineName: vaccine.name,
        appliedOn: input.date,
      });
      if (check.blocked) {
        throw new DomainError('VACCINE_SEX_BLOCKED', {
          params: vaccineSexBlockedParams(vaccine.name, animal.sex),
          fieldErrors: { vaccineId: ['Esta vacuna no se aplica al sexo del animal.'] },
        });
      }

      const nextDueOn = this.nextDueOn(schedule, input.date, input.nextDueOn);
      const cycle = await this.cycleFor(tx, scope, vaccine, input.date);
      const id = input.id ?? uuidv7();
      const created = await tx.vaccinationRecord.create({
        data: {
          id,
          farmId: scope.farmId,
          animalId: animal.id,
          vaccineId: vaccine.id,
          appliedOn: toPrismaDate(input.date),
          dose: input.dose ?? vaccine.defaultDose ?? null,
          batchNumber: input.batchNumber ?? null,
          ruvNumber: input.ruvNumber ?? null,
          cycleId: cycle?.id ?? null,
          responsible: input.responsible ?? null,
          nextDueOn: nextDueOn === null ? null : toPrismaDate(nextDueOn),
          notes: input.notes ?? null,
          createdById: userId,
          createdAt: at,
          updatedAt: at,
        },
        include,
      });
      await audit(tx, {
        scope,
        entity: 'VaccinationRecord',
        entityId: id,
        action: AUDIT_ACTION.CREATE,
        at,
        diff: {
          after: {
            animalId: animal.id,
            vaccineId: vaccine.id,
            appliedOn: input.date,
            cycleId: cycle?.id ?? null,
            nextDueOn,
          },
        },
      });
      return { ...toView(created), warnings: check.warnings };
    });
  }

  /**
   * Próxima fecha (RN-12): solo en vacunas de intervalo. Sin valor, la propone el intervalo; la
   * persona puede cambiarla o dejarla vacía (`null`). Tiene que ser posterior a la aplicación.
   */
  private nextDueOn(
    schedule: VaccineSchedule,
    date: IsoDate,
    requested: IsoDate | null | undefined,
  ): IsoDate | null {
    if (schedule.scheduleType !== VACCINE_SCHEDULE_TYPE.INTERVAL) {
      if (requested != null) {
        throw fieldError(
          'VALIDATION_FAILED',
          'nextDueOn',
          'La próxima fecha solo aplica a las vacunas de intervalo.',
        );
      }
      return null;
    }
    if (requested === undefined) return nextDueOnFromInterval(date, schedule.boosterIntervalDays);
    if (requested !== null && requested <= date) {
      throw fieldError(
        'VALIDATION_FAILED',
        'nextDueOn',
        'La próxima fecha debe ser posterior a la aplicación.',
      );
    }
    return requested;
  }

  /** Vacuna activa de la finca. */
  private async vaccineOf(tx: Tx, scope: FarmScope, vaccineId: string): Promise<VaccineRow> {
    const vaccine = await tx.vaccine.findFirst({ where: { id: vaccineId, farmId: scope.farmId } });
    if (vaccine === null) {
      throw fieldError('VALIDATION_FAILED', 'vaccineId', 'Esa vacuna no existe en esta finca.');
    }
    if (!vaccine.isActive) {
      throw fieldError(
        'VALIDATION_FAILED',
        'vaccineId',
        'La vacuna está desactivada. Actívala en Configuración para registrarla.',
      );
    }
    return vaccine;
  }

  /** Ciclos oficiales activos que incluyen la vacuna (sin las quitadas, ADR-012). */
  private async cyclesOf(
    tx: Tx,
    scope: FarmScope,
    vaccineId: string,
  ): Promise<{ id: string; name: string; startsOn: IsoDate; endsOn: IsoDate }[]> {
    const rows = await tx.vaccinationCycle.findMany({
      where: {
        farmId: scope.farmId,
        isActive: true,
        isOfficial: true,
        vaccines: { some: { vaccineId, removedAt: null } },
      },
      select: { id: true, name: true, startsOn: true, endsOn: true },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      startsOn: fromPrismaDate(row.startsOn),
      endsOn: fromPrismaDate(row.endsOn),
    }));
  }

  /** Ciclo oficial en que queda la aplicación (SAN-06): solo vacunas de ciclo oficial. */
  private async cycleFor(
    tx: Tx,
    scope: FarmScope,
    vaccine: VaccineRow,
    date: IsoDate,
  ): Promise<{ id: string; name: string; startsOn: IsoDate; endsOn: IsoDate } | null> {
    if (vaccine.scheduleType !== VACCINE_SCHEDULE_TYPE.OFFICIAL_CYCLE) return null;
    return cycleContaining(await this.cyclesOf(tx, scope, vaccine.id), date);
  }

  // -------------------------------------------------------------------------------------------
  // Por lote (SAN-03)
  // -------------------------------------------------------------------------------------------

  /**
   * Vacunación por lote: los animales elegidos (por id o con los filtros del listado), menos los
   * excluidos. Se omiten, con su motivo, los que no aplican o ya la tienen (`bulkVaccinationDecision`
   * de shared). Con `dryRun`, solo el plan; sin él, todo en una transacción con `Idempotency-Key`,
   * que vuelve a decidir con los datos de ese momento.
   */
  async bulk(
    scope: FarmScope,
    input: BulkVaccinationInput,
    dryRun: boolean,
  ): Promise<BulkVaccinationResult> {
    const context = await this.farmContext.load(scope);
    const ids = await this.selection(scope, context, input);
    if (input.date > context.today) {
      throw new DomainError('DATE_IN_FUTURE', {
        fieldErrors: { date: ['La fecha no puede ser posterior a hoy.'] },
      });
    }
    if (dryRun) {
      return this.prisma.$transaction((tx) => this.planBulk(tx, scope, input, ids, null));
    }
    const at = this.clock.now();
    return this.transactions.run(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM animals
          WHERE farm_id = ${scope.farmId}::uuid AND id = ANY(${ids}::uuid[])
          ORDER BY id FOR UPDATE`;
        return this.planBulk(tx, scope, input, ids, at);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /** Ids de la selección: `animalIds` o los filtros del listado, menos `excludeIds`. */
  private async selection(
    scope: FarmScope,
    context: FarmContext,
    input: BulkVaccinationInput,
  ): Promise<string[]> {
    const excluded = new Set(input.excludeIds ?? []);
    if (input.animalIds !== undefined) {
      const ids = [...new Set(input.animalIds)];
      const found = await this.prisma.animal.count({
        where: { farmId: scope.farmId, id: { in: ids } },
      });
      if (found !== ids.length) throw new DomainError('NOT_FOUND');
      return ids.filter((id) => !excluded.has(id));
    }
    const filter = input.filter;
    if (filter === undefined) return [];
    const conditions = this.animalList.conditions(scope, filter);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH ${classificationCtes(classificationParams(scope, context))}
      SELECT a.id FROM classified c JOIN animals a ON a.id = c.animal_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY a.code, a.id
      LIMIT ${BULK_FILTER_MAX + 1}::int`);
    if (rows.length > BULK_FILTER_MAX) {
      throw new DomainError('VALIDATION_FAILED', {
        detail: `La selección supera los ${BULK_FILTER_MAX.toLocaleString('es-CO')} animales. Filtra más.`,
      });
    }
    return rows.map((row) => row.id).filter((id) => !excluded.has(id));
  }

  /** Decide animal por animal y, si `at` no es `null`, escribe las vacunaciones. */
  private async planBulk(
    tx: Tx,
    scope: FarmScope,
    input: BulkVaccinationInput,
    ids: readonly string[],
    at: Date | null,
  ): Promise<BulkVaccinationResult> {
    const vaccine = await this.vaccineOf(tx, scope, input.vaccineId);
    const schedule = scheduleOf(vaccine);
    const cycle = await this.cycleFor(tx, scope, vaccine, input.date);
    // Dentro de una transacción las consultas van en serie: comparten una sola conexión.
    const animals = await tx.animal.findMany({
      where: { farmId: scope.farmId, id: { in: [...ids] } },
      select: {
        id: true,
        code: true,
        name: true,
        sex: true,
        birthDate: true,
        entryDate: true,
        entryDateEstimated: true,
        deletedAt: true,
        exitType: true,
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    const records = await tx.vaccinationRecord.findMany({
      where: { farmId: scope.farmId, vaccineId: vaccine.id, animalId: { in: [...ids] } },
      select: { animalId: true, appliedOn: true, nextDueOn: true, voidedAt: true },
    });

    const toApply: AnimalRef[] = [];
    const skipped: BulkVaccinationSkipped[] = [];
    const warnings: { animal: AnimalRef; warning: Warning }[] = [];
    for (const animal of animals) {
      const ref = animalRef(animal);
      const decision = bulkVaccinationDecision({
        vaccine: schedule,
        vaccineName: vaccine.name,
        animal: {
          sex: animal.sex,
          birthDate: fromPrismaDate(animal.birthDate),
          entryDate: fromPrismaDate(animal.entryDate),
          entryDateEstimated: animal.entryDateEstimated,
          active: animal.deletedAt === null && animal.exitType === null,
        },
        records: records
          .filter((record) => record.animalId === animal.id)
          .map((record) => ({
            appliedOn: fromPrismaDate(record.appliedOn),
            nextDueOn: fromPrismaDateOrNull(record.nextDueOn),
            voided: record.voidedAt !== null,
          })),
        cycle,
        date: input.date,
      });
      if (!decision.apply) {
        skipped.push({ animal: ref, reason: decision.skip });
        continue;
      }
      toApply.push(ref);
      for (const item of decision.warnings) warnings.push({ animal: ref, warning: item });
    }

    const base = {
      selected: animals.length,
      toApply,
      skipped,
      warnings,
      cycle: cycle === null ? null : { id: cycle.id, name: cycle.name },
    };
    if (at === null) return { ...base, dryRun: true, created: 0 };

    const nextDueOn = this.nextDueOn(schedule, input.date, undefined);
    const userId = userOf(scope);
    const rows = toApply.map((animal) => ({
      id: uuidv7(),
      farmId: scope.farmId,
      animalId: animal.id,
      vaccineId: vaccine.id,
      appliedOn: toPrismaDate(input.date),
      dose: input.dose ?? vaccine.defaultDose ?? null,
      batchNumber: input.batchNumber ?? null,
      ruvNumber: input.ruvNumber ?? null,
      cycleId: cycle?.id ?? null,
      responsible: input.responsible ?? null,
      nextDueOn: nextDueOn === null ? null : toPrismaDate(nextDueOn),
      notes: input.notes ?? null,
      createdById: userId,
      createdAt: at,
      updatedAt: at,
    }));
    if (rows.length > 0) {
      await tx.vaccinationRecord.createMany({ data: rows });
      await tx.auditLog.createMany({
        data: rows.map((row) => ({
          farmId: scope.farmId,
          userId,
          entity: 'VaccinationRecord',
          entityId: row.id,
          action: AUDIT_ACTION.CREATE,
          diff: {
            after: {
              animalId: row.animalId,
              vaccineId: row.vaccineId,
              appliedOn: input.date,
              cycleId: row.cycleId,
              bulk: true,
            },
          },
          createdAt: at,
        })),
      });
    }
    return { ...base, dryRun: false, created: rows.length };
  }

  // -------------------------------------------------------------------------------------------
  // Anulación (RN-11)
  // -------------------------------------------------------------------------------------------

  async void(scope: FarmScope, id: string, input: VoidEventInput): Promise<VaccinationView> {
    const at = this.clock.now();
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM vaccination_records
        WHERE id = ${id}::uuid AND farm_id = ${scope.farmId}::uuid FOR UPDATE`;
      const current = await tx.vaccinationRecord.findFirst({
        where: { id, farmId: scope.farmId },
        include,
      });
      if (current === null) throw new DomainError('NOT_FOUND');
      if (current.voidedAt !== null) return asReplayed(toView(current));
      const updated = await tx.vaccinationRecord.update({
        where: { id },
        data: { voidedAt: at, voidReason: input.reason },
        include,
      });
      await audit(tx, {
        scope,
        entity: 'VaccinationRecord',
        entityId: id,
        action: AUDIT_ACTION.VOID,
        at,
        diff: { after: { reason: input.reason, animalId: current.animalId } },
      });
      return toView(updated);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Avance de un ciclo oficial (SAN-06 CA2)
  // -------------------------------------------------------------------------------------------

  /**
   * Vacunados y pendientes por vacuna del ciclo, entre los animales activos que podían vacunarse
   * en él: de sexo elegible y en la finca antes del cierre (ADR-004, con el ingreso estimado como
   * presente desde el nacimiento).
   */
  async cycleProgress(scope: FarmScope, cycleId: string): Promise<CycleProgressView> {
    const cycle = await this.prisma.vaccinationCycle.findFirst({
      where: { id: cycleId, farmId: scope.farmId },
      select: { id: true, name: true, startsOn: true, endsOn: true },
    });
    if (cycle === null) throw new DomainError('NOT_FOUND');
    const rows = await this.prisma.$queryRaw<
      { vaccine_id: string; name: string; eligible: number; vaccinated: number }[]
    >(Prisma.sql`
      SELECT v.id AS vaccine_id, v.name,
        count(a.id)::int AS eligible,
        count(a.id) FILTER (WHERE EXISTS (
          SELECT 1 FROM vaccination_records r
          WHERE r.animal_id = a.id AND r.vaccine_id = v.id AND r.voided_at IS NULL
            AND r.applied_on BETWEEN cy.starts_on AND cy.ends_on))::int AS vaccinated
      FROM vaccination_cycles cy
      JOIN vaccination_cycle_vaccines cv ON cv.cycle_id = cy.id AND cv.removed_at IS NULL
      JOIN vaccines v ON v.id = cv.vaccine_id
      LEFT JOIN animals a ON a.farm_id = cy.farm_id
        AND a.deleted_at IS NULL AND a.exit_type IS NULL
        AND (v.eligible_sex IS NULL OR v.eligible_sex = a.sex)
        AND (CASE WHEN a.entry_date_estimated THEN a.birth_date
                  ELSE GREATEST(a.birth_date, a.entry_date) END) <= cy.ends_on
      WHERE cy.id = ${cycleId}::uuid AND cy.farm_id = ${scope.farmId}::uuid
      GROUP BY v.id, v.name
      ORDER BY v.name`);
    const today = this.clock.today();
    const startsOn = fromPrismaDate(cycle.startsOn);
    const endsOn = fromPrismaDate(cycle.endsOn);
    return {
      cycle: { id: cycle.id, name: cycle.name, startsOn, endsOn },
      state: today < startsOn ? 'UPCOMING' : today > endsOn ? 'CLOSED' : 'CURRENT',
      vaccines: rows.map((row) => ({
        vaccineId: row.vaccine_id,
        name: row.name,
        eligible: row.eligible,
        vaccinated: row.vaccinated,
        pending: row.eligible - row.vaccinated,
      })),
    };
  }
}
