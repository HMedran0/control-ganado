import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_ENTITY,
  DomainError,
  type AuditAction,
  type AuditChangeView,
  type AuditEntity,
  type AuditEntryView,
  type AuditPage,
  type AuditQuery,
  type AuditValue,
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

/** Campos con montos: nunca salen de la API por aquí (RN-20, CLAUDE.md regla 2). */
const MONEY_FIELD = /amount|price|cost/i;

/** Campos internos que no le dicen nada a quien consulta. */
const HIDDEN_FIELDS = new Set(['id', 'animalId', 'farmId', 'replacedById']);

/** Campos con ids que se muestran con el nombre o el código de lo que señalan. */
const REFERENCE_FIELDS = {
  breedId: 'breed',
  lotId: 'lot',
  damId: 'animal',
  sireId: 'animal',
  tagIds: 'tag',
} as const;
type ReferenceKind = (typeof REFERENCE_FIELDS)[keyof typeof REFERENCE_FIELDS];

const ENTITIES = Object.values(AUDIT_ENTITY);

/**
 * Consulta de la auditoría (AUD-01 CA2), solo ADMIN.
 *
 * Solo lee las entidades de `AUDIT_ENTITY`: los gastos, las ventas y los inicios de sesión no
 * salen por aquí, y de las demás se quitan los campos con montos. Los ids (raza, lote, madre,
 * etiquetas) se devuelven como nombre o código, para que la web los muestre en lenguaje de finca.
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
      filters.push(Prisma.sql`(
        (l.entity = ${AUDIT_ENTITY.ANIMAL} AND l.entity_id = ${query.animalId}::uuid)
        OR (l.entity = ${AUDIT_ENTITY.IDENTIFIER} AND l.entity_id IN (
          SELECT i.id FROM identifiers i
           WHERE i.farm_id = ${farm} AND i.animal_id = ${query.animalId}::uuid)))`);
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
    const changes = page.map((row) => rawChanges(row.diff));
    const names = await this.resolveReferences(scope, changes.flat());
    const labels = await this.entityLabels(scope, page);

    const items: AuditEntryView[] = page.map((row, index) => ({
      id: row.id.toString(),
      at: row.created_at.toISOString(),
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      entityLabel: labels.get(row.entity_id) ?? null,
      user: row.user_id === null ? null : { id: row.user_id, name: row.user_name ?? '' },
      changes: (changes[index] ?? []).map((change) => resolveChange(change, names)),
    }));
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined ? encodeCursor({ id: last.id.toString() }) : null,
    };
  }

  /** Nombres de las razas, lotes, animales y etiquetas que aparecen en los cambios. */
  private async resolveReferences(
    scope: FarmScope,
    changes: readonly RawChange[],
  ): Promise<Map<string, string>> {
    const ids: Record<ReferenceKind, Set<string>> = {
      breed: new Set(),
      lot: new Set(),
      animal: new Set(),
      tag: new Set(),
    };
    for (const change of changes) {
      const kind = referenceKind(change.field);
      if (kind === null) continue;
      for (const value of [change.before, change.after]) {
        for (const id of idsIn(value)) ids[kind].add(id);
      }
    }
    const farmId = scope.farmId;
    const [breeds, lots, animals, tags] = await Promise.all([
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
    ]);
    return new Map<string, string>([
      ...breeds.map((row) => [row.id, row.name] as const),
      ...lots.map((row) => [row.id, row.name] as const),
      ...animals.map((row) => [row.id, row.code] as const),
      ...tags.map((row) => [row.id, row.label] as const),
    ]);
  }

  /** Cómo nombrar cada registro: código del animal, valor del identificador, nombre… */
  private async entityLabels(
    scope: FarmScope,
    rows: readonly AuditRow[],
  ): Promise<Map<string, string>> {
    const idsOf = (entity: AuditEntity) => [
      ...new Set(rows.filter((row) => row.entity === entity).map((row) => row.entity_id)),
    ];
    const farmId = scope.farmId;
    const [animals, identifiers, breeds, lots, tags, vaccines, cycles, farms, users] =
      await Promise.all([
        this.prisma.animal.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.ANIMAL) } },
          select: { id: true, code: true },
        }),
        this.prisma.identifier.findMany({
          where: { farmId, id: { in: idsOf(AUDIT_ENTITY.IDENTIFIER) } },
          select: { id: true, value: true },
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
      ]);
    return new Map<string, string>([
      ...animals.map((row) => [row.id, row.code] as const),
      ...identifiers.map((row) => [row.id, row.value] as const),
      ...breeds.map((row) => [row.id, row.name] as const),
      ...lots.map((row) => [row.id, row.name] as const),
      ...tags.map((row) => [row.id, row.label] as const),
      ...vaccines.map((row) => [row.id, row.name] as const),
      ...cycles.map((row) => [row.id, row.name] as const),
      ...farms.map((row) => [row.id, row.name] as const),
      ...users.map((row) => [row.id, row.name] as const),
    ]);
  }
}

type RawChange = { field: string; before: unknown; after: unknown };

/**
 * Diferencias guardadas → cambios por campo. La auditoría guarda tres formas:
 * `{ changed, before, after }` (ediciones), `{ after }` (creación, salida, archivo) y
 * `{ before, after }` o `{ before }` (identificadores, reversiones, anulaciones).
 */
function rawChanges(diff: unknown): RawChange[] {
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
    if (HIDDEN_FIELDS.has(field) || MONEY_FIELD.test(field)) continue;
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
