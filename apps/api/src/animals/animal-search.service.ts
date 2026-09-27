import { Injectable } from '@nestjs/common';
import {
  FUZZY_SEARCH_MIN_LENGTH,
  IDENTIFIER_TYPE,
  animalStatus,
  normalizeIdentifier,
  type AnimalStatus,
  type ExitType,
  type IdentifierType,
  type SearchMatch,
  type SearchResult,
  type SearchResultItem,
  type Sex,
} from '@hato/shared';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Resultados como máximo en la búsqueda difusa. */
const FUZZY_LIMIT = 20;

/** Etiquetas de coincidencia; entran como parámetros, no como texto del SQL. */
const MATCH_KIND = { CODE: 'CODE', NAME: 'NAME', IDENTIFIER: 'IDENTIFIER' } as const;

type AnimalSummary = {
  id: string;
  code: string;
  name: string | null;
  sex: Sex;
  exitType: ExitType | null;
};

type FuzzyRow = {
  animal_id: string;
  kind: 'CODE' | 'NAME' | 'IDENTIFIER';
  identifier_type: IdentifierType | null;
  value: string;
  previous: boolean;
  score: number;
};

/**
 * Prioridad de una coincidencia exacta: identificador activo, código, identificador anterior
 * (05: «si `q` coincide exactamente con un identificador activo o anterior»).
 */
function priority(match: SearchMatch): number {
  if (match.kind === 'IDENTIFIER') return match.previous ? 2 : 0;
  return 1;
}

/**
 * Búsqueda global (ANI-05, IDN-02 CA2).
 *
 * 1. **Exacta:** el texto, normalizado como cada tipo de identificador lo normaliza, contra los
 *    identificadores activos y retirados; y contra el código, sin distinguir mayúsculas. Si
 *    todas las coincidencias son del mismo animal (lo normal: chapeta «087» y código «087»),
 *    responde `exactMatch` y la interfaz abre la ficha. Si son de animales distintos, no hay
 *    `exactMatch`: se listan, cada uno con el porqué.
 * 2. **Difusa** (desde dos caracteres): `pg_trgm` y `ILIKE` sobre código, nombre e
 *    identificadores.
 *
 * Los archivados no aparecen; los que salieron sí, con su estado.
 */
@Injectable()
export class AnimalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(scope: FarmScope, q: string): Promise<SearchResult> {
    const exact = await this.exactMatches(scope, q);
    const exactIds = [...exact.keys()];

    let exactMatch: SearchResult['exactMatch'] = null;
    const [onlyId] = exactIds;
    if (exactIds.length === 1 && onlyId !== undefined) {
      const matches = exact.get(onlyId) ?? [];
      const via = [...matches].sort((left, right) => priority(left) - priority(right))[0];
      if (via !== undefined) exactMatch = { animalId: onlyId, via, matches };
    }

    const fuzzy =
      q.length >= FUZZY_SEARCH_MIN_LENGTH ? await this.fuzzyMatches(scope, q, exactIds) : [];

    const animals = await this.summaries(scope, [
      ...exactIds,
      ...fuzzy.map((entry) => entry.animalId),
    ]);

    const items: SearchResultItem[] = [];
    for (const [animalId, matches] of exact) {
      const animal = animals.get(animalId);
      if (animal !== undefined) items.push(toItem(animal, true, matches));
    }
    for (const entry of fuzzy) {
      const animal = animals.get(entry.animalId);
      if (animal !== undefined) items.push(toItem(animal, false, entry.matches));
    }
    return { exactMatch, items };
  }

  /** Coincidencias exactas agrupadas por animal, en orden de prioridad. */
  private async exactMatches(scope: FarmScope, q: string): Promise<Map<string, SearchMatch[]>> {
    const types = Object.values(IDENTIFIER_TYPE);
    const byType = types
      .map((type) => ({ type, value: normalizeIdentifier(type, q) }))
      .filter((candidate) => candidate.value !== '');

    const [identifiers, codes] = await Promise.all([
      this.prisma.identifier.findMany({
        where: {
          farmId: scope.farmId,
          OR: byType,
          animal: { farmId: scope.farmId, deletedAt: null },
        },
        select: { animalId: true, type: true, value: true, retiredAt: true },
        orderBy: [{ retiredAt: { sort: 'desc', nulls: 'first' } }, { assignedAt: 'desc' }],
      }),
      this.prisma.animal.findMany({
        where: {
          farmId: scope.farmId,
          deletedAt: null,
          code: { equals: q.trim(), mode: 'insensitive' },
        },
        select: { id: true, code: true },
      }),
    ]);

    const matches: { animalId: string; match: SearchMatch }[] = [
      ...identifiers.map((identifier) => ({
        animalId: identifier.animalId,
        match: {
          kind: 'IDENTIFIER' as const,
          identifierType: identifier.type,
          value: identifier.value,
          previous: identifier.retiredAt !== null,
        },
      })),
      ...codes.map((animal) => ({
        animalId: animal.id,
        match: { kind: 'CODE' as const, value: animal.code },
      })),
    ].sort((left, right) => priority(left.match) - priority(right.match));

    const grouped = new Map<string, SearchMatch[]>();
    for (const { animalId, match } of matches) {
      grouped.set(animalId, [...(grouped.get(animalId) ?? []), match]);
    }
    return grouped;
  }

  /** Coincidencias difusas, sin los animales que ya coincidieron exactamente. */
  private async fuzzyMatches(
    scope: FarmScope,
    q: string,
    excluded: readonly string[],
  ): Promise<{ animalId: string; matches: SearchMatch[] }[]> {
    const text = q.trim();
    const upper = text.toUpperCase();
    const pattern = `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const farmId = Prisma.sql`${scope.farmId}::uuid`;

    const rows = await this.prisma.$queryRaw<FuzzyRow[]>(Prisma.sql`
      WITH hits AS (
        SELECT a.id AS animal_id, ${MATCH_KIND.CODE}::text AS kind, NULL::text AS identifier_type,
          a.code AS value, false AS previous,
          GREATEST(similarity(a.code, ${text}), CASE WHEN a.code ILIKE ${pattern} THEN 0.5 ELSE 0 END) AS score
        FROM animals a
        WHERE a.farm_id = ${farmId} AND a.deleted_at IS NULL
          AND (a.code ILIKE ${pattern} OR a.code % ${text})
        UNION ALL
        SELECT a.id, ${MATCH_KIND.NAME}::text, NULL::text, a.name, false,
          GREATEST(similarity(a.name, ${text}), CASE WHEN a.name ILIKE ${pattern} THEN 0.5 ELSE 0 END)
        FROM animals a
        WHERE a.farm_id = ${farmId} AND a.deleted_at IS NULL AND a.name IS NOT NULL
          AND (a.name ILIKE ${pattern} OR a.name % ${text})
        UNION ALL
        SELECT i.animal_id, ${MATCH_KIND.IDENTIFIER}::text, i.type::text, i.value, (i.retired_at IS NOT NULL),
          GREATEST(similarity(i.value, ${upper}), CASE WHEN i.value ILIKE ${pattern} THEN 0.5 ELSE 0 END)
        FROM identifiers i
        JOIN animals a ON a.id = i.animal_id AND a.farm_id = ${farmId} AND a.deleted_at IS NULL
        WHERE i.farm_id = ${farmId}
          AND (i.value ILIKE ${pattern} OR i.value % ${upper})
      ),
      best AS (
        SELECT animal_id, max(score) AS score FROM hits
        WHERE NOT (animal_id = ANY(${[...excluded]}::uuid[]))
        GROUP BY animal_id
        ORDER BY max(score) DESC, animal_id
        LIMIT ${FUZZY_LIMIT}::int
      )
      SELECT h.animal_id, h.kind, h.identifier_type, h.value, h.previous, h.score::float8 AS score
      FROM hits h JOIN best b ON b.animal_id = h.animal_id
      ORDER BY b.score DESC, h.animal_id, h.score DESC`);

    const grouped = new Map<string, SearchMatch[]>();
    for (const row of rows) {
      const match: SearchMatch =
        row.kind === 'IDENTIFIER'
          ? {
              kind: 'IDENTIFIER',
              identifierType: row.identifier_type ?? IDENTIFIER_TYPE.OTHER,
              value: row.value,
              previous: row.previous,
            }
          : { kind: row.kind, value: row.value };
      grouped.set(row.animal_id, [...(grouped.get(row.animal_id) ?? []), match]);
    }
    return [...grouped].map(([animalId, matches]) => ({ animalId, matches }));
  }

  private async summaries(
    scope: FarmScope,
    ids: readonly string[],
  ): Promise<Map<string, AnimalSummary>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.animal.findMany({
      where: { farmId: scope.farmId, id: { in: [...ids] }, deletedAt: null },
      select: { id: true, code: true, name: true, sex: true, exitType: true },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }
}

function toItem(animal: AnimalSummary, exact: boolean, matches: SearchMatch[]): SearchResultItem {
  // Los archivados no llegan hasta aquí: la búsqueda los excluye.
  const status: AnimalStatus = animalStatus({ archived: false, exitType: animal.exitType });
  return {
    id: animal.id,
    code: animal.code,
    name: animal.name,
    sex: animal.sex,
    status,
    exact,
    matches,
  };
}
