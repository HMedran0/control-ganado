/**
 * Suma de verificación del contenido de la base de datos.
 *
 * Sirve para comprobar el determinismo del seed: dos ejecuciones seguidas tienen que dar
 * exactamente la misma suma, identificadores y marcas de tiempo incluidos. Se calcula en el
 * servidor, ordenando las filas para que el orden físico no influya.
 */

import type { SeedClient } from './client.js';
import { Prisma } from '../../src/generated/prisma/client.js';

/** Tablas que el seed escribe, en orden alfabético para que el informe sea estable. */
export const SEEDED_TABLES = [
  'animal_tags',
  'animals',
  'breeds',
  'expense_allocations',
  'expenses',
  'farms',
  'identifiers',
  'lot_movements',
  'lots',
  'memberships',
  'pregnancies',
  'sales',
  'tags',
  'treatment_records',
  'users',
  'vaccination_cycle_vaccines',
  'vaccination_cycles',
  'vaccination_records',
  'vaccines',
  'valuations',
  'weight_records',
  'work_sessions',
] as const;

/** Suma md5 de cada tabla y del conjunto. */
export type Checksum = {
  readonly perTable: ReadonlyMap<string, string>;
  readonly overall: string;
};

/**
 * Calcula la suma de una tabla: cada fila se convierte a texto, se ordenan y se resumen.
 *
 * `t::text` serializa la fila completa, así que cualquier diferencia en cualquier columna
 * —un identificador, una fecha, un monto— cambia la suma.
 */
async function tableChecksum(prisma: SeedClient, table: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ checksum: string | null }[]>(
    Prisma.sql`
      SELECT md5(coalesce(string_agg(row_text, '|' ORDER BY row_text), '')) AS checksum
      FROM (SELECT t::text AS row_text FROM ${Prisma.raw(`"${table}"`)} AS t) AS rows`,
  );
  return rows[0]?.checksum ?? '';
}

/** Suma de verificación de todas las tablas que el seed escribe. */
export async function databaseChecksum(prisma: SeedClient): Promise<Checksum> {
  const perTable = new Map<string, string>();
  for (const table of SEEDED_TABLES) {
    perTable.set(table, await tableChecksum(prisma, table));
  }

  const combined = [...perTable].map(([table, sum]) => `${table}:${sum}`).join('\n');
  const [row] = await prisma.$queryRaw<{ checksum: string }[]>(
    Prisma.sql`SELECT md5(${combined}) AS checksum`,
  );
  return { perTable, overall: row?.checksum ?? '' };
}
