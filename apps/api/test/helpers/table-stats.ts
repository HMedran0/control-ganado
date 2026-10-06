import type { PrismaService } from '../../src/infra/prisma.service.js';

/**
 * Último `ANALYZE` manual de cada tabla (`pg_stat_user_tables.last_analyze`), o `null` si nunca
 * se analizó a mano. Sirve para comprobar que una importación actualiza las estadísticas.
 */
export async function lastAnalyzed(
  prisma: PrismaService,
  tables: readonly string[],
): Promise<Map<string, Date | null>> {
  const rows = await prisma.$queryRaw<{ relname: string; last_analyze: Date | null }[]>`
    SELECT relname::text AS relname, last_analyze
    FROM pg_stat_user_tables
    WHERE schemaname = current_schema() AND relname = ANY(${[...tables]}::text[])`;
  return new Map(rows.map((row) => [row.relname, row.last_analyze]));
}
