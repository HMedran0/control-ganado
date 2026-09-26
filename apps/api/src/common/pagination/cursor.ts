import { DomainError } from '@hato/shared';

/**
 * Paginación por cursor: `?limit=50&cursor=<opaco>` → `{ items, nextCursor }` (05-api.md).
 *
 * El cursor es opaco a propósito: lleva la clave del último elemento en base64url, así que el
 * cliente no puede construirlo a mano ni depender de su forma, y no se rompe si mañana el
 * orden necesita otra columna.
 */

/** Página de resultados. */
export type Page<TItem> = {
  readonly items: readonly TItem[];
  /** Cursor para la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
};

/** Límite por defecto y máximo (05-api.md: máximo 200). */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Parámetros de paginación validados. */
export type Pagination = {
  readonly limit: number;
  readonly cursor: CursorPayload | null;
};

/** Contenido del cursor: identifica el último elemento devuelto. */
export type CursorPayload = Readonly<Record<string, string | number>>;

/** Codifica el cursor en base64url. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodifica un cursor.
 * @throws {DomainError} `VALIDATION_FAILED` si no es un cursor válido.
 */
export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('forma inesperada');
    }
    return parsed as CursorPayload;
  } catch (cause) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'El cursor de paginación no es válido. Vuelve a cargar el listado.',
      fieldErrors: { cursor: ['El cursor de paginación no es válido.'] },
      cause,
    });
  }
}

/**
 * Valida `limit` y `cursor` de la query.
 * @throws {DomainError} `VALIDATION_FAILED` si `limit` no es un entero entre 1 y 200.
 */
export function parsePagination(query: { limit?: string | number; cursor?: string }): Pagination {
  const limit = parseLimit(query.limit);
  return {
    limit,
    cursor: query.cursor === undefined || query.cursor === '' ? null : decodeCursor(query.cursor),
  };
}

function parseLimit(raw: string | number | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: `El límite debe ser un número entero entre 1 y ${MAX_LIMIT}.`,
      fieldErrors: { limit: [`Debe ser un número entero entre 1 y ${MAX_LIMIT}.`] },
    });
  }
  return value;
}

/**
 * Arma la página a partir de los resultados de la consulta.
 *
 * La consulta debe pedir `limit + 1` elementos: el extra es lo que dice si hay más páginas,
 * sin necesidad de un `COUNT` aparte.
 */
export function buildPage<TItem>(
  rows: readonly TItem[],
  limit: number,
  cursorOf: (item: TItem) => CursorPayload,
): Page<TItem> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
