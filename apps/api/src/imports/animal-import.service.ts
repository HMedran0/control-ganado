import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  IMPORT_NEW_BREED_GESTATION_DAYS,
  IMPORT_NEW_BREED_GROUP,
  PREGNANCY_OUTCOME,
  SERVICE_METHOD,
  WEIGHT_METHOD,
  catalogNameKey,
  importColumnLabel,
  mapImportHeaders,
  normalizeAnimalCode,
  parseAnimalImportRows,
  resolveAnimalImport,
  uuidv7,
  validateIdentifier,
  type AnimalImportConfirmFields,
  type AnimalImportContext,
  type AnimalImportPreview,
  type AnimalImportResult,
  type AnimalImportResultView,
  type IdentifierType,
  type ImportFarmAnimal,
  type ImportIssue,
  type ImportParentRef,
  type ImportSourceRow,
  type Sex,
} from '@hato/shared';

import { FarmContextService, type FarmContext } from '../animals/farm-context.service.js';
import { codeTakenError, findCodeHolders } from '../animals/code-availability.js';
import {
  assertIdentifierFree,
  findIdentifierUses,
  identifierKey,
  type IdentifierUse,
} from '../animals/identifier-rules.js';
import { EntitlementsService, PLAN_LIMIT } from '../common/entitlements/entitlements.service.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { ANALYZABLE_TABLE, TableStatsService } from '../infra/table-stats.service.js';
import { readSpreadsheet, type SheetContent, type UploadedFile } from './spreadsheet-reader.js';

/**
 * Importación del inventario desde Excel o CSV (ANI-09; ADR-011).
 *
 * - **Simulación primero** (CA3): lee, valida y responde fila por fila sin escribir nada. Corre
 *   dentro de una transacción de solo lectura con las mismas verificaciones que la confirmación.
 * - **Confirmación** (CA5): vuelve a leer y validar todo **dentro** de la transacción que
 *   escribe, así que lo que entra es lo que es verdad en ese momento; o entran todas las filas
 *   válidas elegidas o ninguna.
 * - **Una sola vez**: la web manda una clave de idempotencia por archivo elegido; repetirla
 *   (doble clic, reintento) devuelve el lote ya creado. Un candado por finca serializa las
 *   importaciones y el índice único de `(farm_id, idempotency_key)` respalda lo demás.
 * - El código de cada fila se verifica con `assertCodeAvailable`, la misma verificación (y el
 *   mismo candado) del registro, la edición, la reversión y la restauración (RN-30, RN-31); los
 *   identificadores, con `checkIdentifier` (RN-19).
 */

/** Tiempo máximo de la transacción de confirmación (5.000 filas con sus verificaciones). */
const CONFIRM_TIMEOUT_MS = 60_000;

/** Resultado de validar el archivo, con las filas leídas para el archivo de errores. */
type AnalyzedFile = {
  readonly sources: readonly ImportSourceRow[];
  readonly result: AnimalImportResult;
};

@Injectable()
export class AnimalImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly farmContext: FarmContextService,
    private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
    private readonly tableStats: TableStatsService,
  ) {}

  /** Simulación (CA3): nada se guarda. */
  async preview(
    scope: FarmScope,
    file: UploadedFile,
    options: { createMissingBreeds: boolean; skipRows: readonly number[] },
  ): Promise<AnimalImportPreview> {
    const content = await readSpreadsheet(file);
    const context = await this.farmContext.load(scope);
    const analyzed = await this.prisma.$transaction(
      (tx) =>
        this.analyze(tx, scope, context, content, options.createMissingBreeds, options.skipRows),
      { timeout: CONFIRM_TIMEOUT_MS, maxWait: 10_000 },
    );
    const previous = await this.prisma.importBatch.findFirst({
      where: { farmId: scope.farmId, kind: 'ANIMALS', fileSha256: sha256(file.data) },
      orderBy: { createdAt: 'desc' },
    });
    const { result } = analyzed;
    return {
      fileName: file.fileName,
      totalRows: result.totalRows,
      validRows: result.validRows,
      warningRows: result.warningRows,
      errorRows: result.errorRows,
      importable: result.plan.length,
      issues: result.issues,
      newBreeds: result.newBreeds,
      previousImport:
        previous === null
          ? null
          : {
              importBatchId: previous.id,
              importedAt: previous.createdAt.toISOString(),
              createdRows: previous.createdRows,
            },
    };
  }

  /**
   * Confirma la importación (CA5): todas las filas válidas elegidas o ninguna.
   *
   * @throws {DomainError} `VERSION_CONFLICT` si el resultado ya no es el de la simulación
   *   (`expectedRows`).
   */
  async confirm(
    scope: FarmScope,
    file: UploadedFile,
    fields: AnimalImportConfirmFields,
  ): Promise<AnimalImportResultView> {
    const replay = await this.replayOf(scope, fields.importKey);
    if (replay !== null) return replay;

    const content = await readSpreadsheet(file);
    const context = await this.farmContext.load(scope);
    const hash = sha256(file.data);

    try {
      const view = await this.prisma.$transaction(
        async (tx) => {
          // Una importación a la vez por finca: dos confirmaciones del mismo archivo (o de dos
          // archivos con los mismos códigos) no se cruzan.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${scope.farmId}::text || ':import', 0))`;
          const again = await this.replayOf(scope, fields.importKey, tx);
          if (again !== null) return again;

          const { result } = await this.analyze(
            tx,
            scope,
            context,
            content,
            fields.createMissingBreeds,
            fields.skipRows,
          );
          // ADR-013: la importación cuenta como alta de las filas que entran (PILOT: sin límite).
          await this.entitlements.checkLimit(
            scope.farmId,
            PLAN_LIMIT.ANIMALS,
            result.plan.length,
            tx,
          );
          if (fields.expectedRows !== undefined && result.plan.length !== fields.expectedRows) {
            throw new DomainError('VERSION_CONFLICT', {
              detail: `El resultado cambió desde la simulación: ahora entrarían ${result.plan.length} animales y no ${fields.expectedRows}. Vuelve a revisar el archivo.`,
            });
          }
          return this.write(tx, scope, context, {
            result,
            fileName: file.fileName,
            hash,
            importKey: fields.importKey,
            skippedByUser: fields.skipRows.length,
          });
        },
        { timeout: CONFIRM_TIMEOUT_MS, maxWait: 10_000 },
      );
      // Después de la transacción y sin esperarlo: la tabla puede haber crecido mucho de golpe.
      this.tableStats.analyzeInBackground(
        [
          ANALYZABLE_TABLE.ANIMALS,
          ANALYZABLE_TABLE.BREEDS,
          ANALYZABLE_TABLE.IDENTIFIERS,
          ANALYZABLE_TABLE.PREGNANCIES,
          ANALYZABLE_TABLE.WEIGHT_RECORDS,
          ANALYZABLE_TABLE.IMPORT_BATCHES,
        ],
        'animal-import',
      );
      return view;
    } catch (error) {
      // Respaldo del candado: si aun así la misma clave entró dos veces, gana la primera.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.replayOf(scope, fields.importKey);
        if (existing !== null) return existing;
      }
      throw error;
    }
  }

  /** Filas con error del archivo, con una columna «Error», para corregirlas (CA5). */
  async errorRows(
    scope: FarmScope,
    file: UploadedFile,
    options: { createMissingBreeds: boolean },
  ): Promise<{ rows: readonly ErrorRow[] }> {
    const content = await readSpreadsheet(file);
    const context = await this.farmContext.load(scope);
    const analyzed = await this.prisma.$transaction(
      (tx) => this.analyze(tx, scope, context, content, options.createMissingBreeds, []),
      { timeout: CONFIRM_TIMEOUT_MS, maxWait: 10_000 },
    );
    const errorsByRow = new Map<number, string[]>();
    for (const issue of analyzed.result.issues) {
      if (issue.severity !== 'error') continue;
      const where = issue.column === null ? '' : `${importColumnLabel(issue.column)}: `;
      errorsByRow.set(issue.row, [
        ...(errorsByRow.get(issue.row) ?? []),
        `${where}${issue.message}`,
      ]);
    }
    const rows = analyzed.sources
      .filter((source) => errorsByRow.has(source.row))
      .map((source) => ({
        row: source.row,
        cells: source.cells,
        error: (errorsByRow.get(source.row) ?? []).join(' · '),
      }));
    return { rows };
  }

  // -------------------------------------------------------------------------------------------

  private async replayOf(
    scope: FarmScope,
    importKey: string,
    tx: Tx = this.prisma,
  ): Promise<AnimalImportResultView | null> {
    const batch = await tx.importBatch.findUnique({
      where: { farmId_idempotencyKey: { farmId: scope.farmId, idempotencyKey: importKey } },
    });
    if (batch === null) return null;
    return {
      importBatchId: batch.id,
      created: batch.createdRows,
      skipped: batch.totalRows - batch.createdRows,
      replayed: true,
    };
  }

  /** Lee, valida y resuelve: los pasos 1 a 3 de `animal-import.ts` con la base en medio. */
  private async analyze(
    tx: Tx,
    scope: FarmScope,
    context: FarmContext,
    content: SheetContent,
    createMissingBreeds: boolean,
    skipRows: readonly number[],
  ): Promise<AnalyzedFile> {
    const headers = mapImportHeaders(content.header);
    if (headers.missing.length > 0) {
      throw new DomainError('IMPORT_FILE_INVALID', {
        detail: `Faltan las columnas ${headers.missing.join(', ')}. Usa la plantilla y no cambies los nombres de las columnas.`,
      });
    }
    if (headers.duplicated.length > 0) {
      throw new DomainError('IMPORT_FILE_INVALID', {
        detail: `Estas columnas están repetidas: ${headers.duplicated.join(', ')}.`,
      });
    }

    const skipped = new Set(skipRows);
    const sources: ImportSourceRow[] = content.rows
      .filter((line) => !skipped.has(line.row))
      .map((line) => {
        const cells: ImportSourceRow['cells'] = {};
        for (const [index, key] of headers.columns) {
          (cells as Record<string, unknown>)[key] = line.cells[index] ?? null;
        }
        return { row: line.row, cells };
      });
    const readIssues: ImportIssue[] = content.cellIssues
      .filter((issue) => !skipped.has(issue.row) && headers.columns.has(issue.columnIndex))
      .map((issue) => ({
        row: issue.row,
        column: headers.columns.get(issue.columnIndex) ?? null,
        severity: 'error',
        message: issue.message,
      }));

    const [breeds, lots] = await Promise.all([
      tx.breed.findMany({
        where: { farmId: scope.farmId },
        select: { id: true, name: true, gestationDays: true, isActive: true },
      }),
      tx.lot.findMany({
        where: { farmId: scope.farmId, isActive: true },
        select: { id: true, name: true },
      }),
    ]);
    const importContext: AnimalImportContext = {
      today: context.today,
      breeds: breeds.filter((breed) => breed.isActive),
      lots,
      farmGestationDays: context.settings.gestationDays,
      minBreedingAgeMonths: context.settings.minBreedingAgeMonths,
      createMissingBreeds,
    };
    const parsed = parseAnimalImportRows(sources, importContext);

    const extraIssues: ImportIssue[] = [...readIssues];
    const inactiveBreeds = new Map(
      breeds
        .filter((breed) => !breed.isActive)
        .map((breed) => [catalogNameKey(breed.name), breed.name]),
    );
    for (const row of parsed.rows) {
      if (row.breed?.kind === 'new' && inactiveBreeds.has(catalogNameKey(row.breed.name))) {
        extraIssues.push({
          row: row.row,
          column: 'breed',
          severity: 'error',
          message: `La raza «${inactiveBreeds.get(catalogNameKey(row.breed.name)) ?? row.breed.name}» está desactivada. Actívala en Configuración → Razas.`,
        });
      }
    }

    // Código e identificadores contra la base, en bloque (unas pocas consultas en lugar de tres
    // por fila): las mismas reglas y mensajes que el alta individual.
    const holders = await findCodeHolders(tx, scope, {
      codes: parsed.rows.flatMap((row) => (row.code === null ? [] : [row.code])),
      codeReuse: context.settings.codeReuse,
    });
    const uses = await findIdentifierUses(
      tx,
      scope,
      parsed.rows.flatMap((row) => row.identifiers),
    );
    for (const row of parsed.rows) {
      if (row.code !== null) {
        const holder = holders.get(normalizeAnimalCode(row.code));
        if (holder !== undefined) {
          extraIssues.push({
            row: row.row,
            column: 'code',
            severity: 'error',
            message: codeTakenError(row.code, holder).detail,
          });
        }
      }
      for (const identifier of row.identifiers) {
        const issue = identifierIssue(scope, identifier, uses);
        if (issue !== null) {
          extraIssues.push({
            row: row.row,
            column:
              identifier.type === 'DIN' ? 'din' : identifier.type === 'RFID' ? 'rfid' : 'visualTag',
            severity: 'error',
            message: issue,
          });
        }
      }
    }

    const farmAnimals = await this.farmAnimalsByCode(
      tx,
      scope,
      parsed.rows.flatMap((row) => [row.damCode, row.sireText]).filter((code) => code !== null),
    );
    const result = resolveAnimalImport(parsed, importContext, { farmAnimals, extraIssues });
    return { sources, result };
  }

  /** Animales no archivados de la finca con esos códigos (normalizados); el activo primero. */
  private async farmAnimalsByCode(
    tx: Tx,
    scope: FarmScope,
    codes: readonly string[],
  ): Promise<Map<string, ImportFarmAnimal>> {
    const keys = [...new Set(codes.map(normalizeAnimalCode))];
    const found = new Map<string, ImportFarmAnimal>();
    if (keys.length === 0) return found;
    const rows = await tx.$queryRaw<
      { id: string; code: string; sex: Sex; birth_date: Date; key: string }[]
    >`
      SELECT a.id, a.code, a.sex::text AS sex, a.birth_date, hato_normalize_code(a.code) AS key
        FROM animals a
       WHERE a.farm_id = ${scope.farmId}::uuid
         AND a.deleted_at IS NULL
         AND hato_normalize_code(a.code) = ANY(${keys}::text[])
       ORDER BY a.exit_type IS NULL DESC, a.created_at DESC`;
    for (const row of rows) {
      if (found.has(row.key)) continue;
      found.set(row.key, {
        id: row.id,
        code: row.code,
        sex: row.sex,
        birthDate: fromPrismaDate(row.birth_date),
      });
    }
    return found;
  }

  /** Escribe el plan: razas nuevas, animales, identificadores, partos, preñeces, pesos y auditoría. */
  private async write(
    tx: Tx,
    scope: FarmScope,
    context: FarmContext,
    input: {
      result: AnimalImportResult;
      fileName: string;
      hash: string;
      importKey: string;
      skippedByUser: number;
    },
  ): Promise<AnimalImportResultView> {
    const { result } = input;
    const userId = scope.userId ?? '';
    const at = this.clock.now();
    const batchId = uuidv7();

    const breedIds = new Map<string, string>();
    for (const name of result.newBreeds) {
      const id = uuidv7();
      breedIds.set(catalogNameKey(name), id);
      await tx.breed.create({
        data: {
          id,
          farmId: scope.farmId,
          name,
          group: IMPORT_NEW_BREED_GROUP,
          gestationDays: IMPORT_NEW_BREED_GESTATION_DAYS,
        },
      });
    }

    const animalIds = new Map(result.plan.map((row) => [row.row, uuidv7()]));
    const refId = (ref: ImportParentRef | null): string | null =>
      ref === null ? null : ref.kind === 'farm' ? ref.id : (animalIds.get(ref.row) ?? null);
    const idOf = (row: number): string => animalIds.get(row) ?? '';

    // En el orden del plan: toda madre del archivo va antes que sus crías.
    await tx.animal.createMany({
      data: result.plan.map((row) => ({
        id: idOf(row.row),
        farmId: scope.farmId,
        code: row.code,
        name: row.name,
        sex: row.sex,
        breedId:
          row.breed.kind === 'existing'
            ? row.breed.id
            : (breedIds.get(catalogNameKey(row.breed.name)) ?? ''),
        birthDate: toPrismaDate(row.birthDate),
        birthDateEstimated: row.birthDateEstimated,
        origin: row.origin,
        entryDate: toPrismaDate(row.entryDate),
        entryDateEstimated: row.entryDateEstimated,
        importedPriorCalvings: row.importedPriorCalvings,
        damId: refId(row.dam),
        sireId: refId(row.sire),
        sireExternalRef: row.sireExternalRef,
        lotId: row.lotId,
        notes: row.notes,
        createdById: userId,
        updatedById: userId,
        createdAt: at,
      })),
    });

    await tx.identifier.createMany({
      data: result.plan.flatMap((row) =>
        row.identifiers.map((identifier) => ({
          id: uuidv7(),
          farmId: scope.farmId,
          animalId: idOf(row.row),
          type: identifier.type,
          value: identifier.value,
          assignedAt: toPrismaDate(row.entryDate),
          createdAt: at,
        })),
      ),
    });

    const pregnancies: Prisma.PregnancyCreateManyInput[] = [];
    for (const row of result.plan) {
      if (row.lastCalving !== null) {
        // Último parto: fecha real, servicio estimado por la gestación de la raza (RN-29). Las
        // preñeces estimadas no entran al intervalo entre partos (RN-38).
        pregnancies.push({
          id: uuidv7(),
          farmId: scope.farmId,
          damId: idOf(row.row),
          serviceDate: toPrismaDate(row.lastCalving.serviceDate),
          serviceDateEstimated: true,
          method: SERVICE_METHOD.UNKNOWN,
          expectedCalvingDate: toPrismaDate(row.lastCalving.date),
          outcome: PREGNANCY_OUTCOME.CALVED,
          outcomeDate: toPrismaDate(row.lastCalving.date),
          isImported: true,
          notes: 'Último parto importado desde Excel.',
          createdById: userId,
          updatedById: userId,
          createdAt: at,
        });
      }
      if (row.pregnancy !== null) {
        pregnancies.push({
          id: uuidv7(),
          farmId: scope.farmId,
          damId: idOf(row.row),
          serviceDate: toPrismaDate(row.pregnancy.serviceDate),
          method: SERVICE_METHOD.UNKNOWN,
          confirmedAt: toPrismaDate(context.today),
          expectedCalvingDate: toPrismaDate(row.pregnancy.expectedCalvingDate),
          outcome: PREGNANCY_OUTCOME.PENDING,
          notes: 'Preñez confirmada importada desde Excel.',
          createdById: userId,
          updatedById: userId,
          createdAt: at,
        });
      }
    }
    await tx.pregnancy.createMany({ data: pregnancies });

    await tx.weightRecord.createMany({
      data: result.plan.flatMap((row) =>
        row.lastWeight === null
          ? []
          : [
              {
                id: uuidv7(),
                farmId: scope.farmId,
                animalId: idOf(row.row),
                weighedOn: toPrismaDate(row.lastWeight.weighedOn),
                weightKg: new Prisma.Decimal(row.lastWeight.weightKg),
                method: WEIGHT_METHOD.SCALE,
                isBirthWeight: row.lastWeight.isBirthWeight,
                notes: 'Importado desde Excel.',
                createdById: userId,
                createdAt: at,
              },
            ],
      ),
    });

    const createdRows = result.plan.length;
    const skipped = result.totalRows - createdRows + input.skippedByUser;
    await tx.importBatch.create({
      data: {
        id: batchId,
        farmId: scope.farmId,
        idempotencyKey: input.importKey,
        fileSha256: input.hash,
        fileName: input.fileName.slice(0, 200),
        totalRows: result.totalRows + input.skippedByUser,
        createdRows,
        errorRows: result.errorRows,
        summary: {
          warningRows: result.warningRows,
          skippedByUser: input.skippedByUser,
          newBreeds: [...result.newBreeds],
        },
        createdById: userId,
        createdAt: at,
      },
    });

    // AUD-01: el lote como una importación, y cada animal como creado por ella.
    await tx.auditLog.createMany({
      data: [
        {
          farmId: scope.farmId,
          userId,
          entity: 'ImportBatch',
          entityId: batchId,
          action: AUDIT_ACTION.IMPORT,
          diff: {
            fileName: input.fileName.slice(0, 200),
            totalRows: result.totalRows + input.skippedByUser,
            createdRows,
            errorRows: result.errorRows,
            skippedByUser: input.skippedByUser,
            newBreeds: [...result.newBreeds],
          },
          createdAt: at,
        },
        ...result.plan.map((row) => ({
          farmId: scope.farmId,
          userId,
          entity: 'Animal',
          entityId: idOf(row.row),
          action: AUDIT_ACTION.CREATE,
          diff: {
            after: {
              code: row.code,
              importFile: input.fileName.slice(0, 200),
              importRow: row.row,
              identifiers: row.identifiers.map((item) => `${item.type}:${item.value}`),
            },
          },
          createdAt: at,
        })),
      ],
    });

    return { importBatchId: batchId, created: createdRows, skipped, replayed: false };
  }
}

/** Fila con error, con sus celdas originales, para el archivo de corrección. */
export type ErrorRow = {
  readonly row: number;
  readonly cells: ImportSourceRow['cells'];
  readonly error: string;
};

/**
 * El error de un identificador del archivo, con las reglas de `checkIdentifier` sobre los usos ya
 * consultados; `null` si se puede asignar.
 */
function identifierIssue(
  scope: FarmScope,
  identifier: { readonly type: IdentifierType; readonly value: string },
  uses: ReadonlyMap<string, readonly IdentifierUse[]>,
): string | null {
  const validation = validateIdentifier(identifier.type, identifier.value);
  if (validation.errorCode !== null) return new DomainError(validation.errorCode).detail;
  try {
    assertIdentifierFree(scope, {
      value: validation.normalized,
      animalId: null,
      existing: uses.get(identifierKey(identifier.type, validation.normalized)) ?? [],
    });
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.detail;
    throw error;
  }
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
