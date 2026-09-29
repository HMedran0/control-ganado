import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DIAGNOSIS_RESULT,
  DomainError,
  PREGNANCY_OUTCOME,
  SERVICE_METHOD,
  expectedCalvingDate,
  formatAge,
  isBreedingAgeLow,
  serviceDateFromGestationMonths,
  uuidv7,
  warning,
  type AbortionInput,
  type CreatePregnancyInput,
  type DiagnosisInput,
  type IsoDate,
  type ListPregnanciesQuery,
  type PregnancyList,
  type PregnancyView,
  type PregnancyWithWarnings,
  type UpdatePregnancyInput,
  type VoidPregnancyInput,
  type Warning,
} from '@hato/shared';

import {
  assertNotBeforeBirth,
  assertNotFuture,
  fieldError,
  userOf,
} from '../animals/animal-rules.js';
import { FarmContextService, type FarmContext } from '../animals/farm-context.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import {
  asReplayed,
  assertSameContent,
  ownRecordOrConflict,
} from '../common/idempotency/client-id.js';
import { TransactionsService } from '../common/idempotency/transactions.service.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import { assertVersion, audit, changesBetween, type Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  pregnancyInclude,
  pregnancySnapshot,
  toPregnancyView,
  type PregnancyRow,
} from './pregnancy-views.js';
import {
  alreadyOpen,
  assertFarmUser,
  assertNotBeforeService,
  assertOpen,
  assertSire,
  lockDam,
  lockPregnancy,
  openPregnancyOf,
  translateOpenViolation,
  type LockedDam,
} from './reproduction-rules.js';

/** Campos de la preñez que registra la auditoría. */
const AUDITED = [
  'serviceDate',
  'serviceDateEstimated',
  'method',
  'sireId',
  'sireExternalRef',
  'confirmedAt',
  'diagnosisResponsible',
  'expectedCalvingDate',
  'expectedCalvingManual',
  'outcome',
  'outcomeDate',
  'calvingType',
  'stillbornCount',
  'responsible',
  'notes',
] as const;

/**
 * Servicios, palpaciones, abortos, correcciones y anulaciones de preñeces (REP-01 a REP-03, REP-05;
 * RN-02 a RN-04, RN-08, RN-14, RN-15). El parto está en `CalvingsService`.
 *
 * Cada caso de uso bloquea la fila de la hembra (y la de la preñez) dentro de su transacción y deja
 * su auditoría en ella. Las acciones sobre una preñez existente aceptan `Idempotency-Key`
 * (`TransactionsService.run`, ADR-012 §2) y la creación, el `id` del cliente (§1).
 */
@Injectable()
export class PregnanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly farmContext: FarmContextService,
    private readonly transactions: TransactionsService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------------------------

  /** `GET /pregnancies`: de la más reciente a la más antigua (por `id`, UUIDv7). */
  async list(scope: FarmScope, query: ListPregnanciesQuery): Promise<PregnancyList> {
    const { limit, cursor } = parsePagination(query);
    const where: Prisma.PregnancyWhereInput = {
      farmId: scope.farmId,
      voidedAt: null,
      ...(query.outcome === undefined || query.outcome.length === 0
        ? {}
        : { outcome: { in: query.outcome } }),
      ...(query.confirmed === undefined
        ? {}
        : { confirmedAt: query.confirmed === 'true' ? { not: null } : null }),
      ...(query.damId === undefined ? {} : { damId: query.damId }),
      ...(query.expectedFrom === undefined && query.expectedTo === undefined
        ? {}
        : {
            expectedCalvingDate: {
              ...(query.expectedFrom === undefined
                ? {}
                : { gte: toPrismaDate(query.expectedFrom) }),
              ...(query.expectedTo === undefined ? {} : { lte: toPrismaDate(query.expectedTo) }),
            },
          }),
      ...(cursor === null ? {} : { id: { lt: String(cursor.id) } }),
    };
    const rows = await this.prisma.pregnancy.findMany({
      where,
      include: pregnancyInclude,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const today = this.clock.today();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toPregnancyView(row, today)),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor({ id: last.id }) : null,
    };
  }

  async get(scope: FarmScope, id: string): Promise<PregnancyView> {
    const row = await this.prisma.pregnancy.findFirst({
      where: { id, farmId: scope.farmId },
      include: pregnancyInclude,
    });
    if (row === null) throw new DomainError('NOT_FOUND');
    return toPregnancyView(row, this.clock.today());
  }

  // -------------------------------------------------------------------------------------------
  // Servicio (REP-01) y preñez confirmada sin servicio conocido (REP-02 CA3)
  // -------------------------------------------------------------------------------------------

  async create(scope: FarmScope, input: CreatePregnancyInput): Promise<PregnancyWithWarnings> {
    const context = await this.farmContext.load(scope);
    const { today } = context;
    const byDiagnosis = input.gestationMonths !== undefined;
    const diagnosisDate = input.diagnosisDate;
    const serviceDate = byDiagnosis
      ? serviceDateFromGestationMonths(diagnosisDate as IsoDate, input.gestationMonths as number)
      : (input.serviceDate as IsoDate);
    const method = byDiagnosis ? SERVICE_METHOD.UNKNOWN : (input.method ?? SERVICE_METHOD.UNKNOWN);

    // ADR-012 §1: el mismo `id` con el mismo contenido devuelve la preñez ya creada (200).
    if (input.id !== undefined) {
      const existing = ownRecordOrConflict(
        await this.prisma.pregnancy.findUnique({
          where: { id: input.id },
          include: pregnancyInclude,
        }),
        scope.farmId,
      );
      if (existing !== null) {
        assertSameContent(
          {
            damId: input.damId,
            serviceDate,
            serviceDateEstimated: byDiagnosis,
            method,
            sireId: input.sireId ?? null,
            sireExternalRef: input.sireExternalRef ?? null,
            responsible: input.responsible ?? null,
            notes: input.notes ?? null,
            confirmedAt: byDiagnosis ? diagnosisDate : null,
          },
          { ...pregnancySnapshot(existing), damId: existing.damId },
        );
        return asReplayed({ ...toPregnancyView(existing, today), warnings: [] });
      }
    }

    if (byDiagnosis) assertNotFuture(diagnosisDate as IsoDate, today, 'diagnosisDate');
    else assertNotFuture(serviceDate, today, 'serviceDate');

    const at = this.clock.now();
    const userId = userOf(scope);
    return this.transactions
      .run(async (tx) => {
        const dam = await lockDam(tx, scope, input.damId);
        const birthDate = fromPrismaDate(dam.birthDate);
        assertNotBeforeBirth(
          serviceDate,
          birthDate,
          byDiagnosis ? 'gestationMonths' : 'serviceDate',
        );
        if (input.sireId != null) await assertSire(tx, scope, input.sireId);
        if (input.diagnosisResponsibleUserId != null) {
          await assertFarmUser(tx, scope, input.diagnosisResponsibleUserId);
        }

        // RN-03: una sola preñez abierta, con la opción de ir a cerrarla.
        const open = await openPregnancyOf(tx, scope, dam.id);
        if (open !== null) throw alreadyOpen(open.id);
        await assertAfterLastClosure(tx, scope, dam.id, serviceDate);

        const warnings: Warning[] = [];
        if (
          isBreedingAgeLow({
            birthDate,
            serviceDate,
            minBreedingAgeMonths: context.settings.minBreedingAgeMonths,
          })
        ) {
          warnings.push(breedingAgeWarning(birthDate, serviceDate, context));
        }

        const id = input.id ?? uuidv7();
        const created = await tx.pregnancy.create({
          data: {
            id,
            farmId: scope.farmId,
            damId: dam.id,
            serviceDate: toPrismaDate(serviceDate),
            serviceDateEstimated: byDiagnosis,
            method,
            sireId: input.sireId ?? null,
            sireExternalRef: input.sireExternalRef ?? null,
            confirmedAt: byDiagnosis ? toPrismaDate(diagnosisDate as IsoDate) : null,
            diagnosisResponsible: byDiagnosis ? (input.diagnosisResponsible ?? null) : null,
            diagnosisResponsibleUserId: byDiagnosis
              ? (input.diagnosisResponsibleUserId ?? null)
              : null,
            expectedCalvingDate: toPrismaDate(expectedFor(dam, serviceDate, context)),
            responsible: input.responsible ?? null,
            notes: input.notes ?? null,
            createdById: userId,
            updatedById: userId,
            createdAt: at,
          },
          include: pregnancyInclude,
        });
        await audit(tx, {
          scope,
          entity: 'Pregnancy',
          entityId: id,
          action: AUDIT_ACTION.CREATE,
          at,
          diff: { after: { damId: dam.id, ...pregnancySnapshot(created) } },
        });
        return { ...toPregnancyView(created, today), warnings };
      })
      .catch(translateOpenViolation);
  }

  // -------------------------------------------------------------------------------------------
  // Palpación (REP-02)
  // -------------------------------------------------------------------------------------------

  /**
   * Positiva: la preñez queda confirmada (Preñada, RN-08); si ya lo estaba, se conserva la primera
   * fecha. Negativa: se cierra con desenlace `FAILED` (vacía).
   */
  async diagnose(
    scope: FarmScope,
    id: string,
    input: DiagnosisInput,
  ): Promise<PregnancyWithWarnings> {
    const today = this.clock.today();
    const date = input.date;
    assertNotFuture(date, today, 'date');
    const at = this.clock.now();
    const userId = userOf(scope);

    return this.transactions.run(async (tx) => {
      const current = await lockPregnancy(tx, scope, id);
      assertOpen(current);
      await lockDam(tx, scope, current.damId);
      assertNotBeforeService(
        date,
        current.serviceDate,
        'date',
        'La palpación no puede ser anterior al servicio.',
      );
      if (input.responsibleUserId != null) {
        await assertFarmUser(tx, scope, input.responsibleUserId);
      }

      const positive = input.result === DIAGNOSIS_RESULT.POSITIVE;
      const updated = await tx.pregnancy.update({
        where: { id },
        data: {
          ...(positive
            ? { confirmedAt: current.confirmedAt ?? toPrismaDate(date) }
            : { outcome: PREGNANCY_OUTCOME.FAILED, outcomeDate: toPrismaDate(date) }),
          diagnosisResponsible: input.responsible ?? current.diagnosisResponsible,
          diagnosisResponsibleUserId: input.responsibleUserId ?? current.diagnosisResponsibleUserId,
          version: { increment: 1 },
          updatedById: userId,
        },
        include: pregnancyInclude,
      });
      await auditChange(tx, scope, at, current, updated, { diagnosis: input.result, date });
      return { ...toPregnancyView(updated, today), warnings: [] };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Aborto (REP-03)
  // -------------------------------------------------------------------------------------------

  /** Cierra la preñez con `ABORTED`: no crea crías ni cuenta como parto. */
  async abort(scope: FarmScope, id: string, input: AbortionInput): Promise<PregnancyWithWarnings> {
    const today = this.clock.today();
    const date = input.date;
    assertNotFuture(date, today, 'date');
    const at = this.clock.now();
    const userId = userOf(scope);

    return this.transactions.run(async (tx) => {
      const current = await lockPregnancy(tx, scope, id);
      assertOpen(current);
      await lockDam(tx, scope, current.damId);
      assertNotBeforeService(
        date,
        current.serviceDate,
        'date',
        'El aborto no puede ser anterior al servicio.',
      );
      const updated = await tx.pregnancy.update({
        where: { id },
        data: {
          outcome: PREGNANCY_OUTCOME.ABORTED,
          outcomeDate: toPrismaDate(date),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          version: { increment: 1 },
          updatedById: userId,
        },
        include: pregnancyInclude,
      });
      await auditChange(tx, scope, at, current, updated);
      return { ...toPregnancyView(updated, today), warnings: [] };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Corrección (PATCH)
  // -------------------------------------------------------------------------------------------

  /**
   * Corrige una preñez con `version` (05, «Convenciones»). Las fechas solo mientras está abierta.
   * Cambiar el servicio recalcula el parto estimado (RN-04) y quita la marca de corrección a mano;
   * escribir el parto estimado lo deja marcado (el recálculo por gestación no lo toca).
   */
  async update(
    scope: FarmScope,
    id: string,
    input: UpdatePregnancyInput,
  ): Promise<PregnancyWithWarnings> {
    const context = await this.farmContext.load(scope);
    const { today } = context;
    const at = this.clock.now();
    const userId = userOf(scope);

    return this.prisma
      .$transaction(async (tx) => {
        const current = assertVersion(await lockPregnancy(tx, scope, id), input.version);
        if (current.voidedAt !== null) {
          throw new DomainError('VALIDATION_FAILED', { detail: 'La preñez está anulada.' });
        }
        const open = current.outcome === PREGNANCY_OUTCOME.PENDING;
        if (!open && (input.serviceDate !== undefined || input.expectedCalvingDate !== undefined)) {
          throw fieldError(
            'VALIDATION_FAILED',
            input.serviceDate === undefined ? 'expectedCalvingDate' : 'serviceDate',
            'Las fechas solo se corrigen mientras la preñez está abierta.',
          );
        }
        const dam = await lockDam(tx, scope, current.damId);
        if (input.sireId != null) await assertSire(tx, scope, input.sireId);

        const serviceDate = input.serviceDate ?? fromPrismaDate(current.serviceDate);
        if (input.serviceDate !== undefined) {
          assertNotFuture(serviceDate, today, 'serviceDate');
          assertNotBeforeBirth(serviceDate, fromPrismaDate(dam.birthDate), 'serviceDate');
          if (current.confirmedAt !== null && serviceDate > fromPrismaDate(current.confirmedAt)) {
            throw fieldError(
              'VALIDATION_FAILED',
              'serviceDate',
              'El servicio no puede ser posterior a la palpación.',
            );
          }
          await assertAfterLastClosure(tx, scope, dam.id, serviceDate, id);
        }

        let expected: { date: IsoDate; manual: boolean } | null = null;
        if (input.expectedCalvingDate !== undefined) {
          const date = input.expectedCalvingDate;
          if (date <= serviceDate) {
            throw fieldError(
              'VALIDATION_FAILED',
              'expectedCalvingDate',
              'El parto estimado debe ser posterior al servicio.',
            );
          }
          expected = { date, manual: true };
        } else if (input.serviceDate !== undefined) {
          expected = { date: expectedFor(dam, serviceDate, context), manual: false };
        }

        const updated = await tx.pregnancy.update({
          where: { id, version: input.version },
          data: {
            ...(input.serviceDate === undefined
              ? {}
              : { serviceDate: toPrismaDate(serviceDate), serviceDateEstimated: false }),
            ...(input.method === undefined ? {} : { method: input.method }),
            ...(input.sireId === undefined ? {} : { sireId: input.sireId }),
            ...(input.sireExternalRef === undefined
              ? {}
              : { sireExternalRef: input.sireExternalRef }),
            ...(input.sireId != null ? { sireExternalRef: null } : {}),
            ...(input.sireExternalRef != null ? { sireId: null } : {}),
            ...(expected === null
              ? {}
              : {
                  expectedCalvingDate: toPrismaDate(expected.date),
                  expectedCalvingManual: expected.manual,
                }),
            ...(input.responsible === undefined ? {} : { responsible: input.responsible }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            version: { increment: 1 },
            updatedById: userId,
          },
          include: pregnancyInclude,
        });
        await auditChange(tx, scope, at, current, updated);
        return { ...toPregnancyView(updated, today), warnings: [] };
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new DomainError('VERSION_CONFLICT', { cause: error });
        }
        throw error;
      });
  }

  // -------------------------------------------------------------------------------------------
  // Anulación (RN-11)
  // -------------------------------------------------------------------------------------------

  /**
   * Anula una preñez registrada por error. Anular lo ya anulado responde 200 con el estado actual
   * (ADR-012 §4). Un parto con crías vivas que siguen en la finca no se anula: primero se
   * archivan sus crías (`PREGNANCY_HAS_CALVES`); las que salieron o están archivadas no bloquean.
   */
  async void(scope: FarmScope, id: string, input: VoidPregnancyInput): Promise<PregnancyView> {
    const today = this.clock.today();
    const at = this.clock.now();
    const userId = userOf(scope);

    return this.transactions.run(async (tx) => {
      const current = await lockPregnancy(tx, scope, id);
      if (current.voidedAt !== null) return asReplayed(toPregnancyView(current, today));

      if (current.outcome === PREGNANCY_OUTCOME.CALVED) {
        const activeCalves = await tx.animal.findMany({
          where: { birthPregnancyId: id, deletedAt: null, exitType: null },
          select: { id: true, code: true },
          orderBy: { code: 'asc' },
        });
        if (activeCalves.length > 0) {
          throw new DomainError('PREGNANCY_HAS_CALVES', {
            detail: `Archiva primero las crías de este parto: ${activeCalves.map((calf) => calf.code).join(', ')}.`,
            context: { calfIds: activeCalves.map((calf) => calf.id).join(',') },
          });
        }
      }

      const updated = await tx.pregnancy.update({
        where: { id },
        data: { voidedAt: at, voidReason: input.reason, updatedById: userId },
        include: pregnancyInclude,
      });
      await audit(tx, {
        scope,
        entity: 'Pregnancy',
        entityId: id,
        action: AUDIT_ACTION.VOID,
        at,
        diff: { after: { reason: input.reason, outcome: current.outcome } },
      });
      return toPregnancyView(updated, today);
    });
  }
}

/** Parto estimado con la gestación de la raza de la madre o, si no tiene, la de la finca (RN-04). */
export function expectedFor(dam: LockedDam, serviceDate: IsoDate, context: FarmContext): IsoDate {
  return expectedCalvingDate({
    serviceDate,
    breedGestationDays: dam.breed.gestationDays,
    farmGestationDays: context.settings.gestationDays,
  });
}

/** RN-15: la hembra está por debajo de la edad mínima reproductiva (advertencia). */
export function breedingAgeWarning(
  birthDate: IsoDate,
  serviceDate: IsoDate,
  context: FarmContext,
): Warning {
  return warning('BREEDING_AGE_LOW', {
    age: formatAge({ birthDate, today: serviceDate }),
    minAge: `${context.settings.minBreedingAgeMonths} meses`,
  });
}

/**
 * Un servicio no puede ser anterior al último parto o aborto de la hembra: esa gestación ya
 * había terminado. (Una palpación negativa sí puede ser posterior a un nuevo servicio.)
 */
async function assertAfterLastClosure(
  tx: Tx,
  scope: FarmScope,
  damId: string,
  serviceDate: IsoDate,
  excludeId?: string,
): Promise<void> {
  const last = await tx.pregnancy.findFirst({
    where: {
      farmId: scope.farmId,
      damId,
      voidedAt: null,
      outcome: { in: [PREGNANCY_OUTCOME.CALVED, PREGNANCY_OUTCOME.ABORTED] },
      outcomeDate: { not: null },
      ...(excludeId === undefined ? {} : { id: { not: excludeId } }),
    },
    orderBy: { outcomeDate: 'desc' },
    select: { outcomeDate: true },
  });
  if (last?.outcomeDate != null && serviceDate <= fromPrismaDate(last.outcomeDate)) {
    throw fieldError(
      'VALIDATION_FAILED',
      'serviceDate',
      'El servicio debe ser posterior al último parto o aborto de la hembra.',
    );
  }
}

async function auditChange(
  tx: Tx,
  scope: FarmScope,
  at: Date,
  before: PregnancyRow,
  after: PregnancyRow,
  extra: Record<string, string> = {},
): Promise<void> {
  const diff = changesBetween(pregnancySnapshot(before), pregnancySnapshot(after), AUDITED);
  await audit(tx, {
    scope,
    entity: 'Pregnancy',
    entityId: after.id,
    action: AUDIT_ACTION.UPDATE,
    at,
    diff: { ...diff, ...extra },
  });
}
