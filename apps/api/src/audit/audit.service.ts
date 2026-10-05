import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_ENTITY,
  DomainError,
  toIsoDate,
  type AuditAction,
  type AuditChangeView,
  type AuditEntity,
  type AuditEntryView,
  type AuditPage,
  type AuditQuery,
  type AuditValue,
  type IsoDate,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { encodeCursor, parsePagination } from '../common/pagination/cursor.js';
import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

type AuditRow = {
  id: bigint;
  created_at: Date;
  action: AuditAction;
  entity: AuditEntity;
  entity_id: string;
  diff: unknown;
  user_id: string | null;
  user_name: string | null;
};

/** Campos internos que no le dicen nada a quien consulta. */
const HIDDEN_FIELDS = new Set([
  'id',
  'animalId',
  'farmId',
  'replacedById',
  'importBatchId',
  'workSessionId',
  'treatmentId',
]);

/** Campo de un gasto con su reparto: un mapa `animalId → monto` (ADR-016). */
const ALLOCATIONS_FIELD = 'allocations';

/** Campos que sobran en una entidad concreta: la madre de una preñez ya es su animal. */
const HIDDEN_BY_ENTITY: Partial<Record<AuditEntity, ReadonlySet<string>>> = {
  Pregnancy: new Set(['damId']),
};

/** Campos con ids que se muestran con el nombre o el código de lo que señalan. */
const REFERENCE_FIELDS = {
  breedId: 'breed',
  lotId: 'lot',
  damId: 'animal',
  sireId: 'animal',
  tagIds: 'tag',
  vaccineId: 'vaccine',
  cycleId: 'cycle',
} as const;
type ReferenceKind = (typeof REFERENCE_FIELDS)[keyof typeof REFERENCE_FIELDS];

const ENTITIES = Object.values(AUDIT_ENTITY);

/**
 * Consulta de la auditoría (AUD-01 CA2), solo ADMIN.
 *
 * Solo lee las entidades de `AUDIT_ENTITY` (los inicios de sesión no salen por aquí). Desde M7
 * trae los montos: la ruta es solo del ADMIN, que ve los montos en todas partes (RN-20); que
 * ningún otro rol los reciba lo garantizan el 403 y la prueba de barrido de RN-20. Los ids (raza,
 * lote, madre, etiquetas…) se devuelven como nombre o código, para que la web los muestre en
 * lenguaje de finca. El reparto de un gasto llega como el número de animales (`animalCount`) o,
 * en la ficha de un animal, como su parte (`share`).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_TIMEZONE'>,
  ) {}

  async list(scope: FarmScope, query: AuditQuery): Promise<AuditPage> {
    const pagination = parsePagination(query);
    const farm = Prisma.sql`${scope.farmId}::uuid`;
    const zone = this.env.APP_TIMEZONE;

    const filters: Prisma.Sql[] = [
      Prisma.sql`l.farm_id = ${farm}`,
      Prisma.sql`l.entity = ANY(${ENTITIES}::text[])`,
    ];
    if (query.animalId !== undefined) {
      const animal = await this.prisma.animal.findFirst({
        where: { id: query.animalId, farmId: scope.farmId },
        select: { id: true },
      });
      if (animal === null) throw new DomainError('NOT_FOUND');
      const animalRef = Prisma.sql`${query.animalId}::uuid`;
      filters.push(Prisma.sql`(
        (l.entity = ${AUDIT_ENTITY.ANIMAL} AND l.entity_id = ${animalRef})
        OR (l.entity = ${AUDIT_ENTITY.IDENTIFIER} AND l.entity_id IN (
          SELECT i.id FROM identifiers i WHERE i.farm_id = ${farm} AND i.animal_id = ${animalRef}))
        OR (l.entity = ${AUDIT_ENTITY.PREGNANCY} AND l.entity_id IN (
          SELECT p.id FROM pregnancies p WHERE p.farm_id = ${farm} AND p.dam_id = ${animalRef}))
        OR (l.entity = ${AUDIT_ENTITY.VACCINATION_RECORD} AND l.entity_id IN (
          SELECT v.id FROM vaccination_records v
           WHERE v.farm_id = ${farm} AND v.animal_id = ${animalRef}))
        OR (l.entity = ${AUDIT_ENTITY.TREATMENT_RECORD} AND l.entity_id IN (
          SELECT t.id FROM treatment_records t
           WHERE t.farm_id = ${farm} AND t.animal_id = ${animalRef}))
        OR (l.entity = ${AUDIT_ENTITY.WEIGHT_RECORD} AND l.entity_id IN (
          SELECT w.id FROM weight_records w
           WHERE w.farm_id = ${farm} AND w.animal_id = ${animalRef}))
        OR (l.entity = ${AUDIT_ENTITY.SALE} AND l.entity_id IN (
          SELECT s.id FROM sales s WHERE s.farm_id = ${farm} AND s.animal_id = ${animalRef}))
        OR (l.entity = ${AUDIT_ENTITY.EXPENSE} AND l.entity_id IN (
          SELECT ea.expense_id FROM expense_allocations ea
           WHERE ea.farm_id = ${farm} AND ea.animal_id = ${animalRef})))`);
    }
    if (query.entity !== undefined) filters.push(Prisma.sql`l.entity = ${query.entity}`);
    if (query.entityId !== undefined) {
      filters.push(Prisma.sql`l.entity_id = ${query.entityId}::uuid`);
    }
    // Días de negocio en la zona de la finca: de las 00:00 de `from` a las 00:00 del día
    // siguiente a `to`.
    if (query.from !== undefined) {
      filters.push(
        Prisma.sql`l.created_at >= (${query.from}::date::timestamp AT TIME ZONE ${zone})`,
      );
    }
    if (query.to !== undefined) {
      filters.push(
        Prisma.sql`l.created_at < ((${query.to}::date + 1)::timestamp AT TIME ZONE ${zone})`,
      );
    }
    const cursor = pagination.cursor;
    if (cursor !== null) filters.push(Prisma.sql`l.id < ${String(cursor.id)}::bigint`);

    const rows = await this.prisma.$queryRaw<AuditRow[]>(Prisma.sql`
      SELECT l.id, l.created_at, l.action::text AS action, l.entity, l.entity_id, l.diff,
             l.user_id, u.name AS user_name
        FROM audit_logs l
        LEFT JOIN users u ON u.id = l.user_id
       WHERE ${Prisma.join(filters, ' AND ')}
       ORDER BY l.id DESC
       LIMIT ${pagination.limit + 1}::int`);

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const changes = page.map((row) => rawChanges(row.diff, row.entity, query.animalId ?? null));
    const names = await this.resolveReferences(scope, changes.flat());
    const labels = await this.entityLabels(scope, page);

    const items: AuditEntryView[] = page.map((row, index) => {
      const subject = labels.get(row.entity_id);
      return {
        id: row.id.toString(),
        at: row.created_at.toISOString(),
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        entityLabel: subject?.label ?? null,
        entityDate: subject?.date ?? null,
        animalCode: subject?.animalCode ?? null,
        user: row.user_id === null ? null : { id: row.user_id, name: row.user_name ?? '' },
        changes: (changes[index] ?? []).map((change) => resolveChange(change, names)),
      };
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeCursor({ id: last.id.toString() }) : null,
    };
  }

  /** Nombres de las razas, lotes, animales, etiquetas, vacunas y ciclos de los cambios. */
  private async resolveReferences(
    scope: FarmScope,
    changes: readonly RawChange[],
  ): Promise<Map<string, string>> {
    const ids: Record<ReferenceKind, Set<string>> = {
      breed: new Set(),
      lot: new Set(),
      animal: new Set(),
      tag: new Set(),
      vaccine: new Set(),
      cycle: new Set(),
    };
    for (const change of changes) {
      const kind = referenceKind(change.field);
      if (kind === null) continue;
      for (const value of [change.before, change.after]) {
        for (const id of idsIn(value)) ids[kind].add(id);
      }
    }
    const farmId = scope.farmId;
    const [breeds, lots, animals, tags, vaccines, cycles] = await Promise.all([
      this.prisma.breed.findMany({
        where: { farmId, id: { in: [...ids.breed] } },
        select: { id: true, name: true },
      }),
      this.prisma.lot.findMany({
        where: { farmId, id: { in: [...ids.lot] } },
        select: { id: true, name: true },
      }),
      this.prisma.animal.findMany({
        where: { farmId, id: { in: [...ids.animal] } },
        select: { id: true, code: true },
      }),
      this.prisma.tag.findMany({
        where: { farmId, id: { in: [...ids.tag] } },
        select: { id: true, label: true },
      }),
      this.prisma.vaccine.findMany({
        where: { farmId, id: { in: [...ids.vaccine] } },
        select: { id: true, name: true },
      }),
      this.prisma.vaccinationCycle.findMany({
        where: { farmId, id: { in: [...ids.cycle] } },
        select: { id: true, name: true },
      }),
    ]);
    return new Map<string, string>([
      ...breeds.map((row) => [row.id, row.name] as const),
      ...lots.map((row) => [row.id, row.name] as const),
      ...animals.map((row) => [row.id, row.code] as const),
      ...tags.map((row) => [row.id, row.label] as const),
      ...vaccines.map((row) => [row.id, row.name] as const),
      ...cycles.map((row) => [row.id, row.name] as const),
    ]);
  }

  /**
   * Cómo nombrar cada registro: código del animal, valor del identificador, nombre… y, en los
   * eventos de M5 y M6, la fecha de negocio y el código del animal.
   */
  private async entityLabels(
    scope: FarmScope,
    rows: readonly AuditRow[],
  ): Promise<Map<string, Subject>> {
    const idsOf = (entity: AuditEntity) => [
      ...new Set(rows.filter((row) => row.entity === entity).map((row) => row.entity_id)),
    ];
    const farmId = scope.farmId;
    const [animals, identifiers, breeds, lots, tags, vaccines, cycles, farms, users, events] =
      await Promise.all([
        this.prisma.animal.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.ANIMAL) } },
          select: { id: true, code: true },
        }),
        this.prisma.identifier.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.IDENTIFIER) } },
          select: { id: true, value: true, animal: { select: { code: true } } },
        }),
        this.prisma.breed.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.BREED) } },
          select: { id: true, name: true },
        }),
        this.prisma.lot.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.LOT) } },
          select: { id: true, name: true },
        }),
        this.prisma.tag.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.TAG) } },
          select: { id: true, label: true },
        }),
        this.prisma.vaccine.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.VACCINE) } },
          select: { id: true, name: true },
        }),
        this.prisma.vaccinationCycle.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.VACCINATION_CYCLE) } },
          select: { id: true, name: true },
        }),
        this.prisma.farm.findMany({
          where: { id: { in: idsOf(AUDIT_ENTITY.FARM).filter((id) => id === farmId) } },
          select: { id: true, name: true },
        }),
        this.prisma.user.findMany({
          where: {
            id: { in: idsOf(AUDIT_ENTITY.USER) },
            memberships: { some: { farmId } },
          },
          select: { id: true, name: true },
        }),
        this.eventSubjects(scope, idsOf),
      ]);
    const named = (id: string, label: string): readonly [string, Subject] => [
      id,
      { label, date: null, animalCode: null },
    ];
    return new Map<string, Subject>([
      ...animals.map(
        (row) => [row.id, { label: row.code, date: null, animalCode: row.code }] as const,
      ),
      ...identifiers.map(
        (row) => [row.id, { label: row.value, date: null, animalCode: row.animal.code }] as const,
      ),
      ...breeds.map((row) => named(row.id, row.name)),
      ...lots.map((row) => named(row.id, row.name)),
      ...tags.map((row) => named(row.id, row.label)),
      ...vaccines.map((row) => named(row.id, row.name)),
      ...cycles.map((row) => named(row.id, row.name)),
      ...farms.map((row) => named(row.id, row.name)),
      ...users.map((row) => named(row.id, row.name)),
      ...events,
    ]);
  }

  /**
   * Eventos de M5 y M6 en una sola consulta: la vacuna, el medicamento, los kilos, el perfil o
   * el archivo, con la fecha de negocio y el animal. Los anulados también: siguen siendo suyos.
   */
  private async eventSubjects(
    scope: FarmScope,
    idsOf: (entity: AuditEntity) => string[],
  ): Promise<(readonly [string, Subject])[]> {
    const farm = Prisma.sql`${scope.farmId}::uuid`;
    const ids = (entity: AuditEntity) => Prisma.sql`${idsOf(entity)}::uuid[]`;
    const rows = await this.prisma.$queryRaw<SubjectRow[]>(Prisma.sql`
      SELECT p.id, NULL::text AS label, to_char(p.service_date, 'YYYY-MM-DD') AS on_date,
             a.code AS animal_code
        FROM pregnancies p JOIN animals a ON a.id = p.dam_id
       WHERE p.farm_id = ${farm} AND p.id = ANY(${ids(AUDIT_ENTITY.PREGNANCY)})
      UNION ALL
      SELECT r.id, v.name, to_char(r.applied_on, 'YYYY-MM-DD'), a.code
        FROM vaccination_records r
        JOIN vaccines v ON v.id = r.vaccine_id
        JOIN animals a ON a.id = r.animal_id
       WHERE r.farm_id = ${farm} AND r.id = ANY(${ids(AUDIT_ENTITY.VACCINATION_RECORD)})
      UNION ALL
      SELECT t.id, t.medication, to_char(t.started_on, 'YYYY-MM-DD'), a.code
        FROM treatment_records t JOIN animals a ON a.id = t.animal_id
       WHERE t.farm_id = ${farm} AND t.id = ANY(${ids(AUDIT_ENTITY.TREATMENT_RECORD)})
      UNION ALL
      SELECT w.id, trim_scale(w.weight_kg)::text, to_char(w.weighed_on, 'YYYY-MM-DD'), a.code
        FROM weight_records w JOIN animals a ON a.id = w.animal_id
       WHERE w.farm_id = ${farm} AND w.id = ANY(${ids(AUDIT_ENTITY.WEIGHT_RECORD)})
      UNION ALL
      SELECT s.id, s.name, NULL, NULL
        FROM scale_profiles s
       WHERE s.farm_id = ${farm} AND s.id = ANY(${ids(AUDIT_ENTITY.SCALE_PROFILE)})
      UNION ALL
      SELECT b.id, b.file_name, NULL, NULL
        FROM import_batches b
       WHERE b.farm_id = ${farm} AND b.id = ANY(${ids(AUDIT_ENTITY.IMPORT_BATCH)})
      UNION ALL
      SELECT e.id, e.description, to_char(e.occurred_on, 'YYYY-MM-DD'), NULL
        FROM expenses e
       WHERE e.farm_id = ${farm} AND e.id = ANY(${ids(AUDIT_ENTITY.EXPENSE)})
      UNION ALL
      SELECT s.id, NULL, to_char(s.sold_on, 'YYYY-MM-DD'), a.code
        FROM sales s JOIN animals a ON a.id = s.animal_id
       WHERE s.farm_id = ${farm} AND s.id = ANY(${ids(AUDIT_ENTITY.SALE)})
      UNION ALL
      SELECT v.id, NULL, to_char(v.valued_on, 'YYYY-MM-DD'), a.code
        FROM valuations v JOIN animals a ON a.id = v.animal_id
       WHERE v.farm_id = ${farm} AND v.id = ANY(${ids(AUDIT_ENTITY.VALUATION)})`);
    return rows.map(
      (row) =>
        [
          row.id,
          {
            label: row.label,
            date: row.on_date === null ? null : toIsoDate(row.on_date),
            animalCode: row.animal_code,
          },
        ] as const,
    );
  }
}

/** Cómo se nombra un registro de la auditoría. */
type Subject = {
  readonly label: string | null;
  readonly date: IsoDate | null;
  readonly animalCode: string | null;
};

type SubjectRow = {
  id: string;
  label: string | null;
  on_date: string | null;
  animal_code: string | null;
};

type RawChange = { field: string; before: unknown; after: unknown };

/**
 * Diferencias guardadas → cambios por campo. La auditoría guarda tres formas:
 * `{ changed, before, after }` (ediciones), `{ after }` (creación, salida, archivo) y
 * `{ before, after }` o `{ before }` (identificadores, reversiones, anulaciones).
 */
function rawChanges(diff: unknown, entity: AuditEntity, animalId: string | null): RawChange[] {
  if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) return [];
  const { changed, before, after } = diff as {
    changed?: unknown;
    before?: unknown;
    after?: unknown;
  };
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  const fields = Array.isArray(changed)
    ? changed.filter((field): field is string => typeof field === 'string')
    : [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];

  const result: RawChange[] = [];
  for (const field of fields) {
    if (HIDDEN_FIELDS.has(field)) continue;
    if (HIDDEN_BY_ENTITY[entity]?.has(field) === true) continue;
    if (field === ALLOCATIONS_FIELD) {
      const change = allocationChange(beforeRecord[field], afterRecord[field], animalId);
      if (change !== null) result.push(change);
      continue;
    }
    // La contraseña cambió, pero su hash no le importa a nadie: se muestra sin valores.
    if (field === 'passwordHash') {
      result.push({ field: 'password', before: null, after: null });
      continue;
    }
    const beforeValue = beforeRecord[field] ?? null;
    const afterValue = afterRecord[field] ?? null;
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    result.push({ field, before: beforeValue, after: afterValue });
  }
  return result;
}

/**
 * El reparto de un gasto, legible: en la ficha de un animal, su parte antes y después (`share`);
 * en las demás consultas, cuántos animales (`animalCount`). `null` si no cambió.
 */
function allocationChange(
  before: unknown,
  after: unknown,
  animalId: string | null,
): RawChange | null {
  const beforeMap = asRecord(before);
  const afterMap = asRecord(after);
  const change: RawChange =
    animalId === null
      ? {
          field: 'animalCount',
          before: before === undefined ? null : Object.keys(beforeMap).length,
          after: after === undefined ? null : Object.keys(afterMap).length,
        }
      : { field: 'share', before: beforeMap[animalId] ?? null, after: afterMap[animalId] ?? null };
  return JSON.stringify(change.before) === JSON.stringify(change.after) ? null : change;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function referenceKind(field: string): ReferenceKind | null {
  return field in REFERENCE_FIELDS
    ? REFERENCE_FIELDS[field as keyof typeof REFERENCE_FIELDS]
    : null;
}

function idsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

/** Valor legible: los ids se cambian por su nombre; lo demás, a un tipo simple. */
function resolveChange(change: RawChange, names: Map<string, string>): AuditChangeView {
  const isReference = referenceKind(change.field) !== null;
  const resolve = (value: unknown): AuditValue => {
    if (value === null || value === undefined) return null;
    if (isReference) {
      if (typeof value === 'string') return names.get(value) ?? '(registro borrado)';
      if (Array.isArray(value)) {
        return value.map((item) =>
          typeof item === 'string' ? (names.get(item) ?? '(registro borrado)') : String(item),
        );
      }
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value;
    }
    return JSON.stringify(value);
  };
  return { field: change.field, before: resolve(change.before), after: resolve(change.after) };
}
