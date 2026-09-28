import { Injectable } from '@nestjs/common';
import {
  ANIMAL_ALERT,
  ANIMAL_LIST_STATUS,
  DomainError,
  ROLE,
  isDerivedTagKey,
  isUuid,
  type AnimalAlert,
  type AnimalList,
  type AnimalListItem,
  type AnimalSort,
  type ExitType,
  type ListAnimalsQuery,
  type Sex,
  type VaccineStatusView,
  type WeightMethod,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { encodeCursor, parsePagination, type CursorPayload } from '../common/pagination/cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import { fromPrismaDate, fromPrismaDateOrNull } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { deriveView } from './animal-views.js';
import { DERIVED_TAG_COLUMN, classificationCtes } from './classification.sql.js';
import {
  FarmContextService,
  classificationParams,
  type FarmContext,
} from './farm-context.service.js';
import { VaccineStatusService } from './vaccine-status.service.js';

/** Fila del listado tal como sale de la consulta. */
type ListRow = {
  id: string;
  code: string;
  name: string | null;
  sex: string;
  birth_date: Date;
  birth_date_estimated: boolean;
  for_sale: boolean;
  exit_type: string | null;
  archived: boolean;
  breed_id: string;
  breed_name: string;
  lot_id: string | null;
  lot_name: string | null;
  calving_count: number;
  last_calving_date: Date | null;
  open_service_date: Date | null;
  open_confirmed_at: Date | null;
  open_expected_calving_date: Date | null;
  withdrawal_until: Date | null;
  weight_kg: Prisma.Decimal | null;
  weighed_on: Date | null;
  weight_method: string | null;
  sort_key: Date | string | Prisma.Decimal;
  total: number;
};

/**
 * Orden del listado (ANI-06 CA3): una lista cerrada de expresiones fijas. `age` va de menor a
 * mayor edad, es decir, de la fecha de nacimiento más reciente a la más antigua. Sin último
 * peso, el animal queda al final en los dos sentidos.
 */
/** Tipo de la clave de orden: cómo se castea el cursor y qué forma debe tener. */
const KEY_KIND = {
  text: { cast: Prisma.sql`::text`, format: /^[\s\S]{1,30}$/ },
  date: { cast: Prisma.sql`::date`, format: /^\d{4}-\d{2}-\d{2}$/ },
  numeric: { cast: Prisma.sql`::numeric`, format: /^-?\d{1,6}(\.\d{1,2})?$/ },
} as const;

type SortSpec = {
  readonly key: Prisma.Sql;
  readonly descending: boolean;
  /** Un cursor manipulado con otra forma da 422, no un error de la base. */
  readonly kind: (typeof KEY_KIND)[keyof typeof KEY_KIND];
};

const SORTS: Readonly<Record<AnimalSort, SortSpec>> = {
  code: { key: Prisma.sql`a.code`, descending: false, kind: KEY_KIND.text },
  '-code': { key: Prisma.sql`a.code`, descending: true, kind: KEY_KIND.text },
  age: { key: Prisma.sql`a.birth_date`, descending: true, kind: KEY_KIND.date },
  '-age': { key: Prisma.sql`a.birth_date`, descending: false, kind: KEY_KIND.date },
  lastWeight: {
    key: Prisma.sql`COALESCE(lw.weight_kg, 100000)`,
    descending: false,
    kind: KEY_KIND.numeric,
  },
  '-lastWeight': {
    key: Prisma.sql`COALESCE(lw.weight_kg, -1)`,
    descending: true,
    kind: KEY_KIND.numeric,
  },
};

/** Alertas que se resuelven con columnas de `classified` (alias `c`). Lista cerrada. */
const SQL_ALERT_COLUMN: Readonly<Partial<Record<AnimalAlert, Prisma.Sql>>> = {
  [ANIMAL_ALERT.CALVING_SOON]: Prisma.sql`c.calving_soon`,
  [ANIMAL_ALERT.WITHDRAWAL]: Prisma.sql`c.withdrawal`,
  [ANIMAL_ALERT.UNCONFIRMED_SERVICE]: Prisma.sql`c.unconfirmed_service`,
};

/** Escapa los comodines de `ILIKE` para buscar el texto tal cual. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Listado con filtros (ANI-06). Los filtros de categoría, etiquetas, edad y alertas se
 * resuelven en SQL con la clasificación de `classification.sql.ts`; cada fila se muestra con
 * las funciones de shared (RN-27).
 *
 * Varios valores en `category`, `breedId` o `lotId` se combinan con «o» (un animal tiene una sola
 * categoría); varios en `tags` o `alerts`, con «y»: cada etiqueta o alerta pedida restringe más.
 */
@Injectable()
export class AnimalListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
    private readonly vaccineStatus: VaccineStatusService,
  ) {}

  async list(scope: FarmScope, query: ListAnimalsQuery): Promise<AnimalList> {
    if (query.status === ANIMAL_LIST_STATUS.ARCHIVED && scope.role !== ROLE.ADMIN) {
      throw new DomainError('FORBIDDEN_ROLE', {
        detail: 'Solo un administrador puede ver los animales archivados.',
      });
    }
    const pagination = parsePagination(query);
    const context = await this.farmContext.load(scope);

    const wantsVaccineAlerts = (query.alerts ?? []).some(
      (alert) => alert === ANIMAL_ALERT.VACCINE_OVERDUE || alert === ANIMAL_ALERT.VACCINE_DUE,
    );
    const farmVaccineStatuses = wantsVaccineAlerts
      ? await this.vaccineStatus.statusesFor(scope, context, 'ALL_ACTIVE')
      : null;

    const conditions = this.conditions(scope, query, farmVaccineStatuses);
    const sort = SORTS[query.sort];
    const direction = sort.descending ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const cursorCondition = cursorSql(pagination.cursor, sort);

    const rows = await this.prisma.$queryRaw<ListRow[]>(Prisma.sql`
      WITH ${classificationCtes(classificationParams(scope, context))}
      SELECT * FROM (
        SELECT a.id, a.code, a.name, a.sex::text AS sex, a.birth_date, a.birth_date_estimated,
          a.for_sale, a.exit_type::text AS exit_type, (a.deleted_at IS NOT NULL) AS archived,
          b.id AS breed_id, b.name AS breed_name, l.id AS lot_id, l.name AS lot_name,
          c.calving_count, c.last_calving_date, c.open_service_date, c.open_confirmed_at,
          c.open_expected_calving_date, c.withdrawal_until,
          lw.weight_kg, lw.weighed_on, lw.method::text AS weight_method,
          ${sort.key} AS sort_key,
          (count(*) OVER ())::int AS total
        FROM classified c
        JOIN animals a ON a.id = c.animal_id
        JOIN breeds b ON b.id = a.breed_id
        LEFT JOIN lots l ON l.id = a.lot_id
        LEFT JOIN LATERAL (
          SELECT w.weight_kg, w.weighed_on, w.method
          FROM weight_records w
          WHERE w.animal_id = a.id AND w.voided_at IS NULL
          ORDER BY w.weighed_on DESC, w.created_at DESC
          LIMIT 1
        ) lw ON true
        WHERE ${Prisma.join(conditions, ' AND ')}
      ) x
      WHERE ${cursorCondition}
      ORDER BY x.sort_key ${direction}, x.id ${direction}
      LIMIT ${pagination.limit + 1}::int`);

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const total = page[0]?.total ?? (await this.countWithoutPage(scope, context, conditions));
    const items = await this.toItems(scope, context, page, farmVaccineStatuses);
    const last = page.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ k: sortKeyText(last.sort_key), id: last.id })
          : null,
      total,
    };
  }

  /**
   * Total cuando la página llega vacía (por ejemplo, un cursor más allá del final): la ventana
   * `count(*) OVER ()` no tiene filas donde viajar.
   */
  private async countWithoutPage(
    scope: FarmScope,
    context: FarmContext,
    conditions: Prisma.Sql[],
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      WITH ${classificationCtes(classificationParams(scope, context))}
      SELECT count(*)::int AS total
      FROM classified c JOIN animals a ON a.id = c.animal_id
      WHERE ${Prisma.join(conditions, ' AND ')}`);
    return rows[0]?.total ?? 0;
  }

  private conditions(
    scope: FarmScope,
    query: ListAnimalsQuery,
    farmVaccineStatuses: ReadonlyMap<string, readonly VaccineStatusView[]> | null,
  ): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [Prisma.sql`a.farm_id = ${scope.farmId}::uuid`];

    if (query.status === ANIMAL_LIST_STATUS.ACTIVE) {
      conditions.push(Prisma.sql`a.deleted_at IS NULL AND a.exit_type IS NULL`);
    } else if (query.status === ANIMAL_LIST_STATUS.EXITED) {
      conditions.push(Prisma.sql`a.deleted_at IS NULL AND a.exit_type IS NOT NULL`);
    } else {
      conditions.push(Prisma.sql`a.deleted_at IS NOT NULL`);
    }

    if (query.q !== undefined && query.q !== '') {
      const pattern = likePattern(query.q);
      conditions.push(Prisma.sql`(a.code ILIKE ${pattern} OR a.name ILIKE ${pattern})`);
    }
    if (query.sex !== undefined) conditions.push(Prisma.sql`a.sex = ${query.sex}::"Sex"`);
    if (query.breedId !== undefined && query.breedId.length > 0) {
      conditions.push(Prisma.sql`a.breed_id = ANY(${query.breedId}::uuid[])`);
    }
    if (query.lotId !== undefined && query.lotId.length > 0) {
      conditions.push(Prisma.sql`a.lot_id = ANY(${query.lotId}::uuid[])`);
    }
    if (query.category !== undefined && query.category.length > 0) {
      conditions.push(Prisma.sql`c.category = ANY(${query.category}::text[])`);
    }
    for (const key of query.tags ?? []) {
      conditions.push(
        isDerivedTagKey(key)
          ? DERIVED_TAG_COLUMN[key]
          : Prisma.sql`EXISTS (
              SELECT 1 FROM animal_tags at JOIN tags t ON t.id = at.tag_id
              WHERE at.animal_id = a.id AND t.farm_id = ${scope.farmId}::uuid AND t.key = ${key})`,
      );
    }
    if (query.ageMinMonths !== undefined) {
      conditions.push(Prisma.sql`c.age_months >= ${query.ageMinMonths}::int`);
    }
    if (query.ageMaxMonths !== undefined) {
      conditions.push(Prisma.sql`c.age_months <= ${query.ageMaxMonths}::int`);
    }
    if (query.forSale !== undefined) {
      conditions.push(Prisma.sql`a.for_sale = ${query.forSale}::boolean`);
    }

    const alerts = query.alerts ?? [];
    if (alerts.length > 0) {
      // Solo los activos tienen alertas.
      conditions.push(Prisma.sql`a.deleted_at IS NULL AND a.exit_type IS NULL`);
    }
    for (const alert of alerts) {
      const column = SQL_ALERT_COLUMN[alert];
      if (column !== undefined) {
        conditions.push(column);
        continue;
      }
      const wanted =
        alert === ANIMAL_ALERT.VACCINE_OVERDUE
          ? (kind: string) => kind === 'OVERDUE'
          : (kind: string) => kind === 'PENDING' || kind === 'UPCOMING';
      const ids = [...(farmVaccineStatuses ?? new Map<string, VaccineStatusView[]>())]
        .filter(([, statuses]) => statuses.some((status) => wanted(status.status)))
        .map(([animalId]) => animalId);
      conditions.push(Prisma.sql`a.id = ANY(${ids}::uuid[])`);
    }

    return conditions;
  }

  private async toItems(
    scope: FarmScope,
    context: FarmContext,
    rows: readonly ListRow[],
    farmVaccineStatuses: ReadonlyMap<string, readonly VaccineStatusView[]> | null,
  ): Promise<AnimalListItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [tagLinks, vaccineStatuses] = await Promise.all([
      this.prisma.animalTag.findMany({
        where: { animalId: { in: ids }, tag: { farmId: scope.farmId } },
        include: { tag: { select: { id: true, key: true, label: true } } },
        orderBy: { tag: { label: 'asc' } },
      }),
      farmVaccineStatuses ?? this.vaccineStatus.statusesFor(scope, context, ids),
    ]);

    return rows.map((row) => {
      const derived = deriveView(
        {
          sex: row.sex as Sex,
          birthDate: fromPrismaDate(row.birth_date),
          calvingCount: row.calving_count,
          lastCalvingDate: fromPrismaDateOrNull(row.last_calving_date),
          openPregnancy:
            row.open_service_date === null || row.open_expected_calving_date === null
              ? null
              : {
                  serviceDate: fromPrismaDate(row.open_service_date),
                  confirmedAt: fromPrismaDateOrNull(row.open_confirmed_at),
                  expectedCalvingDate: fromPrismaDate(row.open_expected_calving_date),
                },
          withdrawalUntil: fromPrismaDateOrNull(row.withdrawal_until),
          archived: row.archived,
          exitType: row.exit_type as ExitType | null,
        },
        context,
        vaccineStatuses.get(row.id) ?? [],
      );
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        sex: row.sex as Sex,
        breed: { id: row.breed_id, name: row.breed_name },
        birthDate: fromPrismaDate(row.birth_date),
        birthDateEstimated: row.birth_date_estimated,
        ageMonths: derived.ageMonths,
        category: derived.category,
        derivedTags: derived.derivedTags,
        calvingCount: row.calving_count,
        manualTags: tagLinks
          .filter((link) => link.animalId === row.id)
          .map((link) => ({ id: link.tag.id, key: link.tag.key, label: link.tag.label })),
        forSale: row.for_sale,
        lot: row.lot_id === null ? null : { id: row.lot_id, name: row.lot_name ?? '' },
        lastWeight:
          row.weight_kg === null || row.weighed_on === null
            ? null
            : {
                weightKg: Number(row.weight_kg),
                weighedOn: fromPrismaDate(row.weighed_on),
                method: row.weight_method as WeightMethod,
              },
        status: derived.status,
        alerts: derived.alerts,
        expectedCalvingDate: derived.expectedCalvingDate,
      };
    });
  }
}

/** Clave de orden como texto, para el cursor. */
function sortKeyText(value: Date | string | Prisma.Decimal): string {
  if (value instanceof Date) return fromPrismaDate(value);
  return value.toString();
}

/** Condición de «después del cursor» en el orden pedido. */
function cursorSql(cursor: CursorPayload | null, sort: SortSpec): Prisma.Sql {
  if (cursor === null) return Prisma.sql`true`;
  const key = cursor.k;
  const id = cursor.id;
  if (
    typeof key !== 'string' ||
    typeof id !== 'string' ||
    !sort.kind.format.test(key) ||
    !isUuid(id)
  ) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'El cursor de paginación no es válido. Vuelve a cargar el listado.',
      fieldErrors: { cursor: ['El cursor de paginación no es válido.'] },
    });
  }
  const bound = Prisma.sql`(${key}${sort.kind.cast}, ${id}::uuid)`;
  return sort.descending
    ? Prisma.sql`(x.sort_key, x.id) < ${bound}`
    : Prisma.sql`(x.sort_key, x.id) > ${bound}`;
}
