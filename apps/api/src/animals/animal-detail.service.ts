import { Inject, Injectable } from '@nestjs/common';
import {
  BREEDER_TAG_KEY,
  systemQrUrl,
  DomainError,
  ROLE,
  SEX,
  TIMELINE_KIND,
  ageInDays,
  animalStatus,
  calvingIntervals,
  isoDateParts,
  summarizePregnancies,
  animalWithdrawals,
  withdrawalUntilOf,
  type AnimalDetail,
  type AnimalRef,
  type CodeHistory,
  type CodeHolderView,
  type ExitType,
  type FieldChange,
  type Genealogy,
  type GenealogyNode,
  type GenealogyParent,
  type IdentifierView,
  type IsoDate,
  type NextCodeResult,
  type Timeline,
  type TimelineItem,
} from '@hato/shared';

import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import type { Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, fromPrismaDateOrNull } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { pregnancyInclude, toPregnancyView } from '../reproduction/pregnancy-views.js';
import { WEIGHT_LIKE_SELECT, deriveView, toWeightLike } from './animal-views.js';
import { suggestFarmCodes } from './code-suggestion.js';
import { FarmContextService, type FarmContext } from './farm-context.service.js';
import { VaccineStatusService } from './vaccine-status.service.js';

/** Campos de la auditoría del animal que no se muestran como edición en la línea de tiempo. */
const EDIT_FIELDS_SHOWN_ELSEWHERE = new Set(['lotId']);

type TimelineRow = {
  key: string;
  kind: TimelineItem['kind'];
  date: Date;
  sort_key: string;
  voided: boolean;
  data: Record<string, unknown>;
};

/** Identificador de la base a su vista. */
export function toIdentifierView(identifier: {
  id: string;
  animalId: string;
  type: IdentifierView['type'];
  value: string;
  assignedAt: Date;
  retiredAt: Date | null;
  retireReason: IdentifierView['retireReason'];
  replacedById: string | null;
  carrier: IdentifierView['carrier'];
}): IdentifierView {
  return {
    id: identifier.id,
    animalId: identifier.animalId,
    type: identifier.type,
    value: identifier.value,
    assignedAt: fromPrismaDate(identifier.assignedAt),
    retiredAt: fromPrismaDateOrNull(identifier.retiredAt),
    retireReason: identifier.retireReason,
    replacedById: identifier.replacedById,
    carrier: identifier.carrier,
  };
}

/**
 * Ficha (ANI-07), línea de tiempo, genealogía y código sugerido.
 *
 * La ficha se arma con las funciones de shared a partir de los registros del animal (RN-27).
 * Los datos económicos solo viajan para ADMIN (RN-20): para los demás, `economics` no existe.
 */
@Injectable()
export class AnimalDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
    private readonly vaccineStatus: VaccineStatusService,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_TIMEZONE' | 'PUBLIC_WEB_URL'>,
  ) {}

  /**
   * Ficha del animal. `db` es la transacción cuando la ficha es la respuesta de una acción con
   * `Idempotency-Key`: se guarda junto con la acción (ADR-012 §2).
   */
  async detail(
    scope: FarmScope,
    id: string,
    context?: FarmContext,
    db: Tx = this.prisma,
  ): Promise<AnimalDetail> {
    const ctx = context ?? (await this.farmContext.load(scope));
    const animal = await db.animal.findFirst({
      where: { id, farmId: scope.farmId },
      include: {
        breed: { select: { id: true, name: true } },
        lot: { select: { id: true, name: true } },
        dam: { select: { id: true, code: true, name: true } },
        sire: { select: { id: true, code: true, name: true } },
        identifiers: {
          orderBy: [{ retiredAt: { sort: 'asc', nulls: 'first' } }, { assignedAt: 'desc' }],
        },
        tags: {
          where: { removedAt: null },
          include: { tag: { select: { id: true, key: true, label: true } } },
        },
        pregnancies: {
          include: pregnancyInclude,
          orderBy: [{ serviceDate: 'desc' }, { id: 'desc' }],
        },
        treatments: {
          select: {
            withdrawalUntil: true,
            voidedAt: true,
            startedOn: true,
            durationDays: true,
            withdrawalMeatDays: true,
            withdrawalMilkDays: true,
          },
        },
        weights: {
          orderBy: [{ weighedOn: 'desc' }, { createdAt: 'desc' }],
          select: { ...WEIGHT_LIKE_SELECT, method: true },
        },
      },
    });
    if (animal === null) throw new DomainError('NOT_FOUND');

    const pregnancies = animal.pregnancies.map((pregnancy) => ({
      outcome: pregnancy.outcome,
      outcomeDate: fromPrismaDateOrNull(pregnancy.outcomeDate),
      serviceDate: fromPrismaDate(pregnancy.serviceDate),
      confirmedAt: fromPrismaDateOrNull(pregnancy.confirmedAt),
      expectedCalvingDate: fromPrismaDate(pregnancy.expectedCalvingDate),
      voided: pregnancy.voidedAt !== null,
    }));
    const facts = summarizePregnancies(pregnancies, animal.importedPriorCalvings);
    const withdrawalUntil = withdrawalUntilOf(
      animal.treatments.map((treatment) => ({
        withdrawalUntil: fromPrismaDateOrNull(treatment.withdrawalUntil),
        voided: treatment.voidedAt !== null,
      })),
    );
    const withdrawals = animalWithdrawals(
      animal.treatments.map((treatment) => ({
        startedOn: fromPrismaDate(treatment.startedOn),
        durationDays: treatment.durationDays,
        withdrawalMeatDays: treatment.withdrawalMeatDays,
        withdrawalMilkDays: treatment.withdrawalMilkDays,
        voided: treatment.voidedAt !== null,
      })),
    );
    const vaccines =
      (await this.vaccineStatus.statusesFor(scope, ctx, [animal.id], db)).get(animal.id) ?? [];
    const birthDate = fromPrismaDate(animal.birthDate);
    const derived = deriveView(
      {
        ...facts,
        sex: animal.sex,
        birthDate,
        withdrawalUntil,
        archived: animal.deletedAt !== null,
        exitType: animal.exitType,
        isBreeder: animal.tags.some((link) => link.tag.key === BREEDER_TAG_KEY),
      },
      ctx,
      vaccines,
      animal.weights.map(toWeightLike),
    );

    const openPregnancy = animal.pregnancies.find(
      (pregnancy) => pregnancy.outcome === 'PENDING' && pregnancy.voidedAt === null,
    );
    const interval = calvingIntervals(
      animal.pregnancies.map((pregnancy) => ({
        outcome: pregnancy.outcome,
        outcomeDate: fromPrismaDateOrNull(pregnancy.outcomeDate),
        serviceDateEstimated: pregnancy.serviceDateEstimated,
        voided: pregnancy.voidedAt !== null,
      })),
    );
    const lastWeight = animal.weights.find((weight) => weight.voidedAt === null);

    const detail: AnimalDetail = {
      id: animal.id,
      code: animal.code,
      name: animal.name,
      sex: animal.sex,
      breed: animal.breed,
      birthDate,
      birthDateEstimated: animal.birthDateEstimated,
      ageMonths: derived.ageMonths,
      ageDays: ageInDays(birthDate, ctx.today),
      category: derived.category,
      derivedTags: derived.derivedTags,
      calvingCount: facts.calvingCount,
      manualTags: animal.tags
        .map((link) => link.tag)
        .sort((left, right) => left.label.localeCompare(right.label, 'es-CO')),
      forSale: animal.forSale,
      lot: animal.lot,
      lastWeight:
        lastWeight === undefined
          ? null
          : {
              weightKg: Number(lastWeight.weightKg),
              weighedOn: fromPrismaDate(lastWeight.weighedOn),
              method: lastWeight.method,
            },
      status: derived.status,
      alerts: derived.alerts,
      expectedCalvingDate: derived.expectedCalvingDate,
      origin: animal.origin,
      originDetail: animal.originDetail,
      entryDate: fromPrismaDate(animal.entryDate),
      entryDateEstimated: animal.entryDateEstimated,
      dam: animal.dam,
      sire: animal.sire,
      sireExternalRef: animal.sireExternalRef,
      notes: animal.notes,
      photoUrl: animal.photoUrl,
      exit:
        animal.exitType === null || animal.exitDate === null
          ? null
          : {
              type: animal.exitType,
              date: fromPrismaDate(animal.exitDate),
              reason: animal.exitReason,
            },
      identifiers: animal.identifiers.map(toIdentifierView),
      reproduction:
        animal.sex === SEX.FEMALE
          ? {
              calvingCount: facts.calvingCount,
              importedPriorCalvings: animal.importedPriorCalvings,
              lastCalvingDate: facts.lastCalvingDate,
              openPregnancy:
                openPregnancy === undefined ? null : toPregnancyView(openPregnancy, ctx.today),
              calvingInterval: { lastDays: interval.lastDays, averageDays: interval.averageDays },
              history: animal.pregnancies.map((pregnancy) => toPregnancyView(pregnancy, ctx.today)),
            }
          : null,
      vaccines: derived.status === 'ACTIVE' ? vaccines : [],
      withdrawalUntil,
      withdrawals: { meatUntil: withdrawals.meatUntil, milkUntil: withdrawals.milkUntil },
      weight: derived.weight,
      codeHistory: await this.codeHistory(scope, animal, db),
      qrUrl: systemQrUrl(this.env.PUBLIC_WEB_URL, animal.id),
      archive:
        animal.deletedAt === null
          ? null
          : { archivedAt: animal.deletedAt.toISOString(), reason: animal.deletedReason },
      version: animal.version,
    };

    if (scope.role !== ROLE.ADMIN) return detail;
    return {
      ...detail,
      economics: { purchasePrice: await this.purchasePrice(scope, animal.id, db) },
    };
  }

  /**
   * Número anterior (ANI-11). Se busca por el código **normalizado** (RN-30) entre los animales
   * no archivados de la finca:
   *
   * - un animal activo ve al último que tuvo su número y salió (`previousHolder`);
   * - uno que salió o está archivado ve al activo que lo tiene hoy (`currentHolder`).
   */
  private async codeHistory(
    scope: FarmScope,
    animal: { id: string; code: string; exitType: ExitType | null; deletedAt: Date | null },
    db: Tx,
  ): Promise<CodeHistory> {
    const isActive = animal.exitType === null && animal.deletedAt === null;
    const holderState = isActive
      ? Prisma.sql`a.exit_type IS NOT NULL`
      : Prisma.sql`a.exit_type IS NULL`;
    const rows = await db.$queryRaw<
      { id: string; code: string; exit_type: ExitType | null; exit_date: Date | null }[]
    >(Prisma.sql`
      SELECT a.id, a.code, a.exit_type::text AS exit_type, a.exit_date
        FROM animals a
       WHERE a.farm_id = ${scope.farmId}::uuid
         AND hato_normalize_code(a.code) = hato_normalize_code(${animal.code}::text)
         AND a.id <> ${animal.id}::uuid
         AND a.deleted_at IS NULL
         AND ${holderState}
       ORDER BY a.exit_date DESC NULLS LAST, a.created_at DESC
       LIMIT 1`);
    const row = rows[0];
    const holder: CodeHolderView | null =
      row === undefined
        ? null
        : {
            animalId: row.id,
            code: row.code,
            status: animalStatus({ archived: false, exitType: row.exit_type }),
            exitDate: fromPrismaDateOrNull(row.exit_date),
          };
    return isActive
      ? { previousHolder: holder, currentHolder: null }
      : { previousHolder: null, currentHolder: holder };
  }

  /**
   * Valor de compra: la asignación **vigente** del gasto `PURCHASE` vigente del animal (ANI-01 CA2).
   * Desde M7, corregir la compra anula la asignación anterior y crea otra (ADR-016).
   */
  private async purchasePrice(scope: FarmScope, animalId: string, db: Tx): Promise<string | null> {
    const allocation = await db.expenseAllocation.findFirst({
      where: {
        farmId: scope.farmId,
        animalId,
        voidedAt: null,
        expense: { type: 'PURCHASE', voidedAt: null },
      },
      select: { amount: true },
      orderBy: { expense: { occurredOn: 'desc' } },
    });
    return allocation === null ? null : allocation.amount.toFixed(2);
  }

  /**
   * Línea de tiempo unificada (ANI-07 CA3), del más reciente al más antiguo. Una sola consulta
   * `UNION ALL` paginada por (fecha, instante, clave). Los eventos anulados aparecen marcados.
   * No incluye nada económico.
   */
  async timeline(
    scope: FarmScope,
    animalId: string,
    query: { limit?: string; cursor?: string },
  ): Promise<Timeline> {
    const pagination = parsePagination(query);
    await this.assertExists(scope, animalId);

    const farm = Prisma.sql`${scope.farmId}::uuid`;
    const animal = Prisma.sql`${animalId}::uuid`;
    const kind = (value: TimelineItem['kind']) => Prisma.sql`${value}::text`;
    const cursor = pagination.cursor;
    const after =
      cursor === null
        ? Prisma.sql`true`
        : Prisma.sql`t.sort_key < ${String(cursor.s)}::text COLLATE "C"`;

    const rows = await this.prisma.$queryRaw<TimelineRow[]>(Prisma.sql`
      WITH events AS (
        SELECT 'birth:' || a.id AS key, ${kind(TIMELINE_KIND.BIRTH)} AS kind, a.birth_date AS date,
          a.created_at AS at, false AS voided,
          jsonb_build_object('birthDateEstimated', a.birth_date_estimated,
            'dam', CASE WHEN d.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) END) AS data
        FROM animals a LEFT JOIN animals d ON d.id = a.dam_id
        WHERE a.id = ${animal} AND a.farm_id = ${farm}
        UNION ALL
        SELECT 'entry:' || a.id, ${kind(TIMELINE_KIND.ENTRY)}, a.entry_date, a.created_at, false,
          jsonb_build_object('originDetail', a.origin_detail)
        FROM animals a
        WHERE a.id = ${animal} AND a.farm_id = ${farm} AND a.origin = ${'PURCHASED'}::"Origin"
        UNION ALL
        SELECT 'service:' || p.id, ${kind(TIMELINE_KIND.SERVICE)}, p.service_date, p.created_at,
          p.voided_at IS NOT NULL,
          jsonb_build_object('pregnancyId', p.id, 'estimated', p.service_date_estimated,
            'sire', CASE WHEN s.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) END,
            'sireExternalRef', p.sire_external_ref)
        FROM pregnancies p LEFT JOIN animals s ON s.id = p.sire_id
        WHERE p.dam_id = ${animal} AND p.farm_id = ${farm}
        UNION ALL
        SELECT 'diagnosis:' || p.id, ${kind(TIMELINE_KIND.DIAGNOSIS)}, p.confirmed_at, p.updated_at,
          p.voided_at IS NOT NULL,
          jsonb_build_object('pregnancyId', p.id, 'result', ${'POSITIVE'}::text)
        FROM pregnancies p
        WHERE p.dam_id = ${animal} AND p.farm_id = ${farm} AND p.confirmed_at IS NOT NULL
        UNION ALL
        SELECT 'outcome:' || p.id, ${kind(TIMELINE_KIND.PREGNANCY_OUTCOME)}, p.outcome_date,
          p.updated_at, p.voided_at IS NOT NULL,
          jsonb_build_object('pregnancyId', p.id, 'outcome', p.outcome::text,
            'stillbornCount', p.stillborn_count)
        FROM pregnancies p
        WHERE p.dam_id = ${animal} AND p.farm_id = ${farm}
          AND p.outcome <> ${'PENDING'}::"PregnancyOutcome" AND p.outcome_date IS NOT NULL
        UNION ALL
        SELECT 'vaccination:' || r.id, ${kind(TIMELINE_KIND.VACCINATION)}, r.applied_on, r.created_at,
          r.voided_at IS NOT NULL,
          jsonb_build_object('vaccineId', v.id, 'vaccine', v.name, 'dose', r.dose)
        FROM vaccination_records r JOIN vaccines v ON v.id = r.vaccine_id
        WHERE r.animal_id = ${animal} AND r.farm_id = ${farm}
        UNION ALL
        SELECT 'treatment:' || t.id, ${kind(TIMELINE_KIND.TREATMENT)}, t.started_on, t.created_at,
          t.voided_at IS NOT NULL,
          jsonb_build_object('medication', t.medication, 'reason', t.reason,
            'withdrawalUntil', t.withdrawal_until)
        FROM treatment_records t
        WHERE t.animal_id = ${animal} AND t.farm_id = ${farm}
        UNION ALL
        SELECT 'weight:' || w.id, ${kind(TIMELINE_KIND.WEIGHT)}, w.weighed_on, w.created_at,
          w.voided_at IS NOT NULL,
          jsonb_build_object('weightKg', w.weight_kg::float8, 'method', w.method::text)
        FROM weight_records w
        WHERE w.animal_id = ${animal} AND w.farm_id = ${farm}
        UNION ALL
        SELECT 'lot:' || m.id, ${kind(TIMELINE_KIND.LOT_MOVEMENT)}, m.moved_on, m.created_at, false,
          jsonb_build_object('fromLot', lf.name, 'toLot', lt.name)
        FROM lot_movements m
        LEFT JOIN lots lf ON lf.id = m.from_lot_id
        LEFT JOIN lots lt ON lt.id = m.to_lot_id
        WHERE m.animal_id = ${animal} AND m.farm_id = ${farm}
        UNION ALL
        SELECT 'identifier:' || i.id, ${kind(TIMELINE_KIND.IDENTIFIER_ASSIGNED)}, i.assigned_at,
          i.created_at, false,
          jsonb_build_object('identifierId', i.id, 'type', i.type::text, 'value', i.value,
            'reason', NULL)
        FROM identifiers i
        WHERE i.animal_id = ${animal} AND i.farm_id = ${farm}
        UNION ALL
        SELECT 'identifier-retired:' || i.id, ${kind(TIMELINE_KIND.IDENTIFIER_RETIRED)}, i.retired_at,
          i.created_at, false,
          jsonb_build_object('identifierId', i.id, 'type', i.type::text, 'value', i.value,
            'reason', i.retire_reason::text)
        FROM identifiers i
        WHERE i.animal_id = ${animal} AND i.farm_id = ${farm} AND i.retired_at IS NOT NULL
        UNION ALL
        SELECT 'exit:' || a.id, ${kind(TIMELINE_KIND.EXIT)}, a.exit_date, a.updated_at, false,
          jsonb_build_object('type', a.exit_type::text, 'reason', a.exit_reason)
        FROM animals a
        WHERE a.id = ${animal} AND a.farm_id = ${farm} AND a.exit_date IS NOT NULL
        UNION ALL
        SELECT 'edit:' || l.id, ${kind(TIMELINE_KIND.EDIT)},
          (l.created_at AT TIME ZONE ${this.env.APP_TIMEZONE})::date, l.created_at, false,
          jsonb_build_object('userName', u.name, 'diff', l.diff)
        FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.farm_id = ${farm} AND l.entity = ${'Animal'} AND l.entity_id = ${animal}
          AND l.action = ${'UPDATE'}::"AuditAction"
      )
      SELECT * FROM (
        -- Clave de orden en un solo texto: fecha, instante en microsegundos y clave. Así el
        -- cursor viaja como texto sin fechas ni zonas que el controlador pueda reinterpretar.
        SELECT e.key, e.kind, e.date, e.voided, e.data,
          to_char(e.date, 'YYYYMMDD')
            || lpad((extract(epoch FROM e.at) * 1000000)::bigint::text, 20, '0')
            || e.key AS sort_key
        FROM events e
      ) t
      WHERE ${after}
      ORDER BY t.sort_key COLLATE "C" DESC
      LIMIT ${pagination.limit + 1}::int`);

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const items = page.map(toTimelineItem).filter((item): item is TimelineItem => item !== null);
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeCursor({ s: last.sort_key }) : null,
    };
  }

  /** Madre y padre con sus padres, y crías con sus crías (05: dos niveles). */
  async genealogy(scope: FarmScope, animalId: string): Promise<Genealogy> {
    const select = {
      id: true,
      code: true,
      name: true,
      sex: true,
      birthDate: true,
      exitType: true,
      deletedAt: true,
    } as const;
    const parentSelect = {
      ...select,
      sireExternalRef: true,
      dam: { select },
      sire: { select },
    } as const;

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId: scope.farmId },
      select: {
        ...select,
        sireExternalRef: true,
        dam: { select: parentSelect },
        sire: { select: parentSelect },
        offspringAsDam: {
          where: { deletedAt: null },
          select: {
            ...select,
            offspringAsDam: { where: { deletedAt: null }, select },
            offspringAsSire: { where: { deletedAt: null }, select },
          },
          orderBy: { birthDate: 'desc' },
        },
        offspringAsSire: {
          where: { deletedAt: null },
          select: {
            ...select,
            offspringAsDam: { where: { deletedAt: null }, select },
            offspringAsSire: { where: { deletedAt: null }, select },
          },
          orderBy: { birthDate: 'desc' },
        },
      },
    });
    if (animal === null) throw new DomainError('NOT_FOUND');

    const parent = (node: (typeof animal)['dam']): GenealogyParent | null =>
      node === null
        ? null
        : {
            ...toNode(node),
            dam: node.dam === null ? null : toNode(node.dam),
            sire: node.sire === null ? null : toNode(node.sire),
            sireExternalRef: node.sireExternalRef,
          };

    return {
      animal: toNode(animal),
      dam: parent(animal.dam),
      sire: parent(animal.sire),
      sireExternalRef: animal.sireExternalRef,
      offspring: [...animal.offspringAsDam, ...animal.offspringAsSire].map((child) => ({
        ...toNode(child),
        offspring: [...child.offspringAsDam, ...child.offspringAsSire]
          .sort((left, right) => right.birthDate.getTime() - left.birthDate.getTime())
          .map(toNode),
      })),
    };
  }

  /**
   * Código sugerido (ANI-10, RN-28):
   *
   * - `LOWEST_FREE`: el menor entero libre en el mismo conjunto donde se exige la unicidad
   *   (ANI-10 CA2): los activos si la finca reutiliza números, todos los no archivados si no;
   * - `PATTERN`: el siguiente con el patrón de las crías (08 §2.3). Cuenta todos los códigos de la
   *   finca, también los de animales archivados, para no reutilizarlos nunca.
   */
  async nextCode(
    scope: FarmScope,
    birthDate: IsoDate | undefined,
    count = 1,
  ): Promise<NextCodeResult> {
    const context = await this.farmContext.load(scope);
    const codes = await suggestFarmCodes(this.prisma, scope, context.settings, {
      year: isoDateParts(birthDate ?? context.today).year,
      count,
    });
    return { code: codes[0] ?? '', codes };
  }

  private async assertExists(scope: FarmScope, animalId: string): Promise<void> {
    const found = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId: scope.farmId },
      select: { id: true },
    });
    if (found === null) throw new DomainError('NOT_FOUND');
  }
}

function toNode(node: {
  id: string;
  code: string;
  name: string | null;
  sex: GenealogyNode['sex'];
  birthDate: Date;
  exitType: Parameters<typeof animalStatus>[0]['exitType'];
  deletedAt: Date | null;
}): GenealogyNode {
  return {
    id: node.id,
    code: node.code,
    name: node.name,
    sex: node.sex,
    birthDate: fromPrismaDate(node.birthDate),
    status: animalStatus({ archived: node.deletedAt !== null, exitType: node.exitType }),
  };
}

/** Diff de la auditoría del animal (`changesBetween`) → cambios por campo. */
function toChanges(diff: unknown): FieldChange[] {
  if (typeof diff !== 'object' || diff === null) return [];
  const { changed, before, after } = diff as {
    changed?: unknown;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  if (!Array.isArray(changed)) return [];
  return changed
    .filter((field): field is string => typeof field === 'string')
    .filter((field) => !EDIT_FIELDS_SHOWN_ELSEWHERE.has(field))
    .map((field) => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}

function asRef(value: unknown): AnimalRef | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as AnimalRef;
}

/** Fila de la consulta → elemento tipado. Una edición sin cambios visibles se omite. */
function toTimelineItem(row: TimelineRow): TimelineItem | null {
  const base = { key: row.key, date: fromPrismaDate(row.date), voided: row.voided };
  const data = row.data;
  switch (row.kind) {
    case 'BIRTH':
      return {
        ...base,
        kind: row.kind,
        data: { birthDateEstimated: data.birthDateEstimated === true, dam: asRef(data.dam) },
      };
    case 'EDIT': {
      const changes = toChanges(data.diff);
      if (changes.length === 0) return null;
      return {
        ...base,
        kind: row.kind,
        data: { userName: (data.userName as string | null) ?? null, changes },
      };
    }
    case 'SERVICE':
      return {
        ...base,
        kind: row.kind,
        data: {
          ...(data as Omit<Extract<TimelineItem, { kind: 'SERVICE' }>['data'], 'sire'>),
          sire: asRef(data.sire),
        },
      };
    default:
      // Los demás tipos llegan de la consulta con la forma exacta de su vista.
      return { ...base, kind: row.kind, data } as TimelineItem;
  }
}
