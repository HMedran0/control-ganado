import { PassThrough, type Writable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_ACTION, DomainError, escapeSpreadsheetText, type IsoDate } from '@hato/shared';
import ExcelJS from 'exceljs';
import type { Logger } from 'pino';

import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.schema.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { LOGGER } from '../infra/logger.js';
import { PrismaService } from '../infra/prisma.service.js';
import {
  AUDIT_ROWS_PER_FILE,
  EXPORT_SHEETS,
  auditFileName,
  loadLookups,
  type ColumnKind,
  type ExportLookups,
  type ExportSheet,
} from './export-sheets.js';
import { buildReadme, type ExportedFile } from './readme.js';
import { ZipWriter, drained, type ZipTimestamp } from './zip-writer.js';

/** Exportaciones completas por finca en una hora (BAK-02, ADR-018). */
export const EXPORTS_PER_HOUR = 3;
const HOUR_MS = 3_600_000;
/** Una exportación a la vez en todo el servidor: la transacción de lectura es larga. */
const GLOBAL_LOCK_KEY = 'hato:export-full';
const BUSY_RETRY_SECONDS = 60;
/** Tope de la transacción: si la descarga es tan lenta que lo pasa, se corta. */
const EXPORT_TIMEOUT_MS = 10 * 60_000;
/** Filas por consulta: en memoria hay un bloque a la vez. */
const BATCH = 2_000;

export const ZIP_CONTENT_TYPE = 'application/zip';

const NUM_FMT: Partial<Record<ColumnKind, string>> = {
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  int: '0',
  decimal: '0.00',
  money: '"$"#,##0.00',
};
const WIDTH: Record<ColumnKind, number> = {
  text: 22,
  date: 12,
  datetime: 17,
  int: 10,
  decimal: 11,
  money: 16,
  bool: 9,
  json: 40,
};

/**
 * Exportación completa de la finca (BAK-02, ADR-018): un ZIP con un `.xlsx` por entidad y un
 * `LEEME.txt`, generado mientras se descarga.
 *
 * 1. Toma, dentro de una transacción `REPEATABLE READ READ ONLY`, el candado global de la
 *    exportación (`pg_try_advisory_xact_lock`): si otra está en curso, `EXPORT_IN_PROGRESS` con
 *    `Retry-After: 60`. La transacción da una foto consistente de toda la finca —ningún evento
 *    sin su animal— y el candado evita tener varias de estas transacciones largas abiertas.
 * 2. Cuenta las exportaciones de la finca en la última hora (de la auditoría, como el bloqueo
 *    del ADR-007): con 3, `EXPORT_LIMIT_REACHED` con `Retry-After` hasta que salga la más vieja.
 * 3. Audita la exportación en su propia transacción, que se confirma enseguida: cuenta para el
 *    límite aunque la descarga falle después.
 * 4. Recién entonces responde 200 y escribe el ZIP: por cada archivo, las filas en bloques de
 *    2.000 ordenadas por `Id`, a un libro de `exceljs` en streaming, y de ahí al ZIP. Si la
 *    descarga va más lenta que la base, espera (`drain`) en lugar de acumular en memoria.
 *
 * Los errores de los pasos 1 a 3 son respuestas normales (problem+json). Uno durante la
 * escritura ya no puede cambiar el estado HTTP: se corta la conexión y el ZIP queda incompleto,
 * cosa que cualquier programa de descompresión detecta.
 */
@Injectable()
export class FullExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_TIMEZONE'>,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Empieza la exportación. Devuelve el nombre del archivo y el stream del ZIP cuando ya pasó
   * el candado, el límite y la auditoría; el ZIP se sigue escribiendo en el stream.
   *
   * @throws {DomainError} `EXPORT_IN_PROGRESS` o `EXPORT_LIMIT_REACHED`.
   */
  async start(scope: FarmScope): Promise<{ fileName: string; stream: PassThrough }> {
    const out = new PassThrough({ highWaterMark: 1024 * 1024 });
    const started = this.clock.now();
    let accepted = false;
    let resolveReady!: (fileName: string) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const run = this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${GLOBAL_LOCK_KEY}, 0)) AS locked`;
        if (lock?.locked !== true) {
          throw new DomainError('EXPORT_IN_PROGRESS', { retryAfterSeconds: BUSY_RETRY_SECONDS });
        }
        await this.checkLimit(tx, scope.farmId, started);

        const farm = await tx.farm.findUniqueOrThrow({
          where: { id: scope.farmId },
          select: { name: true },
        });
        const today = this.clock.today();
        await this.prisma.auditLog.create({
          data: {
            farmId: scope.farmId,
            userId: scope.userId ?? null,
            entity: 'Farm',
            entityId: scope.farmId,
            action: AUDIT_ACTION.EXPORT,
            diff: { format: 'zip-xlsx' },
            createdAt: started,
          },
        });
        accepted = true;
        resolveReady(exportFileName(farm.name, today));

        await this.writeZip(tx, scope.farmId, farm.name, out, started);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: EXPORT_TIMEOUT_MS,
        maxWait: 10_000,
      },
    );

    run.then(
      () => {
        out.end();
        this.logger.info(
          { farmId: scope.farmId, ms: Date.now() - started.getTime() },
          'Exportación completa terminada',
        );
      },
      (error: unknown) => {
        if (!accepted) {
          rejectReady(error);
          return;
        }
        this.logger.error(
          { err: error, farmId: scope.farmId },
          'La exportación completa se interrumpió',
        );
        out.destroy(error instanceof Error ? error : new Error(String(error)));
      },
    );

    const fileName = await ready;
    return { fileName, stream: out };
  }

  private async checkLimit(tx: Tx, farmId: string, now: Date): Promise<void> {
    const since = new Date(now.getTime() - HOUR_MS);
    const recent = await tx.auditLog.findMany({
      where: { farmId, action: AUDIT_ACTION.EXPORT, createdAt: { gt: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (recent.length < EXPORTS_PER_HOUR) return;
    // Se libera un cupo cuando la más vieja de las que cuentan cumple una hora.
    const oldest = recent[recent.length - EXPORTS_PER_HOUR]?.createdAt ?? now;
    const seconds = Math.max(1, Math.ceil((oldest.getTime() + HOUR_MS - now.getTime()) / 1000));
    throw new DomainError('EXPORT_LIMIT_REACHED', {
      params: { minutes: Math.max(1, Math.ceil(seconds / 60)) },
      retryAfterSeconds: seconds,
    });
  }

  private async writeZip(
    tx: Tx,
    farmId: string,
    farmName: string,
    out: Writable,
    started: Date,
  ): Promise<void> {
    const zip = new ZipWriter(out, this.wallClock(started));
    const lookups = await loadLookups(tx, farmId);
    const files: ExportedFile[] = [];
    for (const sheet of EXPORT_SHEETS) {
      files.push(...(await this.writeSheet(zip, tx, farmId, sheet, lookups, out)));
    }
    const readme = buildReadme({
      farmName,
      generatedAt: this.wallClock(started),
      sheets: EXPORT_SHEETS,
      files,
    });
    await zip.addEntry('LEEME.txt', readme, { level: 9 });
    await zip.finish();
  }

  /** Un archivo (o varios, si la auditoría pasa del límite de filas de Excel). */
  private async writeSheet(
    zip: ZipWriter,
    tx: Tx,
    farmId: string,
    sheet: ExportSheet<unknown>,
    lookups: ExportLookups,
    out: Writable,
  ): Promise<ExportedFile[]> {
    const written: ExportedFile[] = [];
    const isAudit = sheet.file === auditFileName(1);
    let part = 1;
    let book = this.openBook(zip, isAudit ? auditFileName(part) : sheet.file, sheet);
    let rows = 0;
    let after: string | null = null;

    for (;;) {
      const batch = await sheet.fetch(tx, farmId, after, BATCH);
      if (batch.length === 0) break;
      for (const row of batch) {
        if (isAudit && rows === AUDIT_ROWS_PER_FILE) {
          written.push({ file: book.file, rows });
          await book.close();
          part += 1;
          book = this.openBook(zip, auditFileName(part), sheet);
          rows = 0;
        }
        book.sheet
          .addRow(sheet.columns.map((column) => this.cell(column.kind, column.value(row, lookups))))
          .commit();
        rows += 1;
      }
      after = sheet.cursor(batch[batch.length - 1]);
      // Si la descarga va más lenta que la base, se espera aquí en lugar de acumular.
      if (out.writableNeedDrain) await drained(out);
      if (batch.length < BATCH) break;
    }
    written.push({ file: book.file, rows });
    await book.close();
    return written;
  }

  private openBook(
    zip: ZipWriter,
    file: string,
    sheet: ExportSheet<unknown>,
  ): { file: string; sheet: ExcelJS.Worksheet; close: () => Promise<void> } {
    const stream = new PassThrough();
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: true,
      useSharedStrings: false,
    });
    workbook.creator = 'Arreo';
    const worksheet = workbook.addWorksheet(sheet.title.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.columns = sheet.columns.map((column, index) => ({
      header: column.header,
      key: `c${index}`,
      width: Math.max(WIDTH[column.kind], Math.min(40, column.header.length + 2)),
      ...(NUM_FMT[column.kind] === undefined ? {} : { style: { numFmt: NUM_FMT[column.kind] } }),
    }));
    // El libro ya comprimido pasa al ZIP mientras se escribe.
    const entry = zip.addEntry(file, stream, { level: 1 });
    return {
      file,
      sheet: worksheet,
      close: async () => {
        worksheet.commit();
        await workbook.commit();
        await entry;
      },
    };
  }

  /** Valor de una celda según su tipo. Todo texto se protege contra fórmulas. */
  private cell(kind: ColumnKind, value: unknown): ExcelJS.CellValue {
    if (value === null || value === undefined) return null;
    switch (kind) {
      case 'text':
        return escapeSpreadsheetText(typeof value === 'string' ? value : JSON.stringify(value));
      case 'json':
        return escapeSpreadsheetText(typeof value === 'string' ? value : JSON.stringify(value));
      case 'bool':
        return value === true ? 'Sí' : 'No';
      case 'int':
        return Number(value);
      case 'decimal':
      case 'money':
        return Number((value as Prisma.Decimal).toString());
      case 'date':
        // Las columnas `date` llegan como medianoche UTC: el mismo día en Excel.
        return value as Date;
      case 'datetime': {
        const wall = this.wallClock(value as Date);
        return new Date(
          Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
        );
      }
    }
  }

  /** Fecha y hora de un instante en la zona de la finca. */
  private wallClock(instant: Date): ZipTimestamp {
    return wallClockIn(instant, this.env.APP_TIMEZONE);
  }
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

/** Fecha y hora de pared de un instante en una zona horaria. */
export function wallClockIn(instant: Date, timeZone: string): ZipTimestamp {
  let formatter = wallFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? NaN);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** `arreo-la-esperanza-2026-10-06.zip`: solo ASCII, para cualquier sistema de archivos. */
export function exportFileName(farmName: string, today: IsoDate): string {
  const slug = farmName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `arreo-${slug === '' ? 'finca' : slug}-${today}.zip`;
}
