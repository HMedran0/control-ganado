import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';

import { LOGGER } from './logger.js';
import { PrismaService } from './prisma.service.js';

/**
 * Tablas que una importación puede llenar de golpe. Es una lista cerrada: el nombre entra en el
 * texto del `ANALYZE` (no se puede pasar como parámetro), así que nunca viene de afuera.
 */
export const ANALYZABLE_TABLE = {
  ANIMALS: 'animals',
  BREEDS: 'breeds',
  IDENTIFIERS: 'identifiers',
  PREGNANCIES: 'pregnancies',
  WEIGHT_RECORDS: 'weight_records',
  WORK_SESSIONS: 'work_sessions',
  WORK_SESSION_ENTRIES: 'work_session_entries',
  IMPORT_BATCHES: 'import_batches',
} as const;
export type AnalyzableTable = (typeof ANALYZABLE_TABLE)[keyof typeof ANALYZABLE_TABLE];

const ALLOWED = new Set<string>(Object.values(ANALYZABLE_TABLE));

/**
 * Estadísticas del planificador después de una carga masiva (M8, ajuste previo).
 *
 * Una importación puede multiplicar el tamaño de una tabla en una sola transacción. Hasta que
 * autovacuum la analiza, PostgreSQL planea con las estadísticas de la tabla casi vacía y las
 * consultas de clasificación pueden pasar de milisegundos a segundos: es el mismo problema que
 * el seed resolvió con `ANALYZE` al terminar.
 *
 * `analyzeInBackground` corre el `ANALYZE` **después** de la transacción y sin que la respuesta
 * lo espere; la duración o el error quedan en el log. Al apagar la API, `PrismaService` espera los
 * que estén en curso antes de cerrar las conexiones.
 */
@Injectable()
export class TableStatsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Lanza el `ANALYZE` de las tablas y vuelve enseguida. */
  analyzeInBackground(tables: readonly AnalyzableTable[], reason: string): void {
    const unique = [...new Set(tables)];
    if (unique.length === 0) return;
    for (const table of unique) {
      // Defensa en profundidad: el tipo ya lo impide, pero el nombre va en el texto del SQL.
      if (!ALLOWED.has(table)) throw new Error(`Tabla no permitida para ANALYZE: ${table}`);
    }
    this.prisma.track(this.analyze(unique, reason));
  }

  /** Espera los `ANALYZE` en curso (en las pruebas). */
  async settled(): Promise<void> {
    await this.prisma.backgroundSettled();
  }

  private async analyze(tables: readonly AnalyzableTable[], reason: string): Promise<void> {
    const started = performance.now();
    try {
      await this.prisma.$executeRawUnsafe(`ANALYZE ${tables.join(', ')}`);
      this.logger.info(
        { tables, reason, durationMs: Math.round(performance.now() - started) },
        'Estadísticas actualizadas después de una importación',
      );
    } catch (error) {
      this.logger.warn(
        { err: error, tables, reason, durationMs: Math.round(performance.now() - started) },
        'No se pudieron actualizar las estadísticas después de una importación',
      );
    }
  }
}
