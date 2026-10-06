import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION,
  DomainError,
  IDENTIFIED_BY,
  IDENTIFIER_TYPE,
  IMPORT_KIND,
  WEIGHT_METHOD,
  WEIGHT_SOURCE,
  WORK_SESSION_ACTIVITY,
  cellText,
  formatDate,
  isDomainError,
  normalizeScaleCode,
  normalizeVisualId,
  parseScaleRow,
  planScaleImport,
  proposeScaleMapping,
  resolveScaleColumns,
  scaleAssociationsSchema,
  scaleColumnMappingSchema,
  uuidv7,
  type ChipAssociationNotice,
  type ScaleAnimal,
  type ScaleAssociation,
  type ScaleColumnMapping,
  type ScaleImportPlan,
  type ScaleLookup,
  type ScaleProfileView,
  type ScaleRowParse,
  type WeightImportDryRun,
  type WeightImportFields,
  type WeightImportResult,
  type WeightRecordLike,
} from '@hato/shared';

import { userOf } from '../animals/animal-rules.js';
import { WEIGHT_LIKE_SELECT, toWeightLike } from '../animals/animal-views.js';
import { checkIdentifier } from '../animals/identifier-rules.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import type { Tx } from '../common/persistence.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  readSpreadsheet,
  type SheetContent,
  type UploadedFile,
} from '../imports/spreadsheet-reader.js';
import { Clock } from '../infra/clock.service.js';
import { fromPrismaDate, toPrismaDate } from '../infra/date-mapper.js';
import { PrismaService } from '../infra/prisma.service.js';
import { ANALYZABLE_TABLE, TableStatsService } from '../infra/table-stats.service.js';
import { ScaleProfilesService } from './scale-profiles.service.js';

/** Una confirmación de 5.000 filas cabe holgada en un minuto (ADR-011). */
const CONFIRM_TIMEOUT_MS = 60_000;

/** Lo que resulta de leer y asociar el archivo, igual en la simulación y en la confirmación. */
type Analysis = {
  readonly totalRows: number;
  readonly profile: ScaleProfileView | null;
  readonly mapping: ScaleColumnMapping;
  readonly columns: WeightImportDryRun['columns'];
  readonly plan: ScaleImportPlan;
  readonly chipNotices: readonly ChipAssociationNotice[];
  /** Asociaciones cuyo chip sí se guarda como RFID del animal. */
  readonly chipsToSave: readonly ScaleAssociation[];
};

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function invalidFile(detail: string): DomainError {
  return new DomainError('SCALE_FILE_INVALID', { detail });
}

/**
 * Importación de la sesión de pesaje de la báscula (PES-04, M6). El mismo camino que la
 * importación del inventario (ADR-011): el archivo se lee con `readSpreadsheet` (tipo real, ZIP
 * medido, CSV en UTF-8 o Windows-1252), la simulación y la confirmación corren el mismo análisis,
 * la confirmación vuelve a analizar dentro de su transacción con el candado de importación de la
 * finca, y la clave del archivo elegido (`importKey`, en `import_batches`) evita importar dos veces.
 * Las reglas puras (mapeo, libras, asociación, repetidos, atípicos) están en
 * `packages/shared/src/domain/scale-import.ts`.
 */
@Injectable()
export class WeightImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly profiles: ScaleProfilesService,
    private readonly tableStats: TableStatsService,
  ) {}

  async preview(
    scope: FarmScope,
    file: UploadedFile,
    fields: WeightImportFields,
  ): Promise<WeightImportDryRun> {
    const content = await readSpreadsheet(file);
    const analysis = await this.prisma.$transaction(
      (tx) => this.analyze(tx, scope, content, fields),
      { timeout: CONFIRM_TIMEOUT_MS, maxWait: 10_000 },
    );
    const previous = await this.prisma.importBatch.findFirst({
      where: { farmId: scope.farmId, kind: IMPORT_KIND.WEIGHTS, fileSha256: sha256(file.data) },
      orderBy: { createdAt: 'desc' },
    });
    return {
      fileName: file.fileName,
      totalRows: analysis.totalRows,
      profile:
        analysis.profile === null
          ? null
          : {
              id: analysis.profile.id,
              name: analysis.profile.name,
              system: analysis.profile.system,
            },
      mapping: analysis.mapping,
      columns: analysis.columns,
      unit: analysis.mapping.unit,
      rows: analysis.plan.rows,
      counts: analysis.plan.counts,
      unknownChips: analysis.plan.unknownChips,
      warnings: analysis.plan.duplicateWarnings,
      importable: analysis.plan.weights.length,
      chipNotices: analysis.chipNotices,
      previousImport:
        previous === null
          ? null
          : { importedAt: previous.createdAt.toISOString(), created: previous.createdRows },
    };
  }

  async confirm(
    scope: FarmScope,
    file: UploadedFile,
    fields: WeightImportFields,
  ): Promise<WeightImportResult> {
    const importKey = fields.importKey;
    if (importKey === undefined) {
      throw new DomainError('VALIDATION_FAILED', {
        fieldErrors: { importKey: ['Falta la clave de la importación.'] },
      });
    }
    const replay = await this.replayOf(scope, importKey);
    if (replay !== null) return replay;

    const content = await readSpreadsheet(file);
    const hash = sha256(file.data);
    const at = this.clock.now();
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          // El mismo candado que la importación del inventario: una importación a la vez por finca.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${scope.farmId}::text || ':import', 0))`;
          const again = await this.replayOf(scope, importKey, tx);
          if (again !== null) return again;

          const analysis = await this.analyze(tx, scope, content, fields);
          const weights = analysis.plan.weights;
          if (fields.expectedRows !== undefined && weights.length !== fields.expectedRows) {
            throw new DomainError('VERSION_CONFLICT', {
              detail: `El resultado cambió desde la simulación: ahora se guardarían ${weights.length} pesajes y no ${fields.expectedRows}. Vuelve a revisar el archivo.`,
            });
          }
          if (weights.length === 0) {
            throw invalidFile('El archivo no tiene pesajes para guardar.');
          }
          return this.write(tx, scope, { analysis, fileName: file.fileName, hash, importKey, at });
        },
        { timeout: CONFIRM_TIMEOUT_MS, maxWait: 10_000 },
      );
      // Después de la transacción y sin esperarlo, como la importación del inventario.
      this.tableStats.analyzeInBackground(
        [
          ANALYZABLE_TABLE.WEIGHT_RECORDS,
          ANALYZABLE_TABLE.WORK_SESSIONS,
          ANALYZABLE_TABLE.WORK_SESSION_ENTRIES,
          ANALYZABLE_TABLE.IDENTIFIERS,
          ANALYZABLE_TABLE.IMPORT_BATCHES,
        ],
        'weight-import',
      );
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.replayOf(scope, importKey);
        if (existing !== null) return existing;
      }
      throw error;
    }
  }

  private async replayOf(
    scope: FarmScope,
    importKey: string,
    tx: Tx = this.prisma,
  ): Promise<WeightImportResult | null> {
    const batch = await tx.importBatch.findUnique({
      where: { farmId_idempotencyKey: { farmId: scope.farmId, idempotencyKey: importKey } },
    });
    if (batch === null || batch.kind !== IMPORT_KIND.WEIGHTS || batch.workSessionId === null) {
      return null;
    }
    const summary = batch.summary as { chipsSaved?: number };
    return {
      importBatchId: batch.id,
      workSessionId: batch.workSessionId,
      created: batch.createdRows,
      skipped: batch.totalRows - batch.createdRows,
      chipsSaved: summary.chipsSaved ?? 0,
      replayed: true,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Análisis
  // -------------------------------------------------------------------------------------------

  private async analyze(
    tx: Tx,
    scope: FarmScope,
    content: SheetContent,
    fields: WeightImportFields,
  ): Promise<Analysis> {
    const today = this.clock.today();
    const headers = content.header.map((cell) => cellText(cell));
    const { profile, mapping } = await this.mappingFor(scope, headers, fields);
    const columns = resolveScaleColumns(headers, mapping);
    if (!columns.ok) throw invalidFile(columns.message);

    const sessionDate = fields.sessionDate ?? today;
    const issuesByRow = new Map<number, string>();
    for (const issue of content.cellIssues) issuesByRow.set(issue.row, issue.message);
    const rows: ScaleRowParse[] = content.rows.map((source) => {
      const issue = issuesByRow.get(source.row);
      if (issue !== undefined) return { ok: false, row: source.row, message: issue };
      return parseScaleRow({
        cells: source.cells,
        row: source.row,
        columns: columns.value,
        mapping,
        sessionDate,
      });
    });

    const associations = this.parseAssociations(fields.associations);
    const skip = (fields.skip ?? '')
      .split(',')
      .map((chip) => chip.trim())
      .filter((chip) => chip !== '');

    const { lookup, weightsOf } = await this.lookup(tx, scope, associations);
    // Primero se asocia sin pesajes, para saber de qué animales leerlos; después, con ellos.
    const firstPass = planScaleImport({ rows, lookup, associations, skip, today });
    await this.loadWeights(
      tx,
      scope,
      weightsOf,
      firstPass.weights.map((item) => item.animalId),
    );
    const plan = planScaleImport({ rows, lookup, associations, skip, today });
    const { notices, toSave } = await this.chipDecisions(tx, scope, lookup, associations, plan);

    return {
      totalRows: content.rows.length,
      profile,
      mapping,
      columns: columns.value.headers,
      plan,
      chipNotices: notices,
      chipsToSave: toSave,
    };
  }

  /** Mapeo del perfil o plantilla elegido, el enviado por la web o el propuesto por los encabezados. */
  private async mappingFor(
    scope: FarmScope,
    headers: readonly string[],
    fields: WeightImportFields,
  ): Promise<{ profile: ScaleProfileView | null; mapping: ScaleColumnMapping }> {
    if (fields.scaleProfileId !== undefined) {
      const profile = await this.profiles.resolve(scope, fields.scaleProfileId);
      if (profile === null) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { scaleProfileId: ['Ese perfil de báscula no existe en esta finca.'] },
        });
      }
      return { profile, mapping: profile.columnMapping };
    }
    if (fields.mapping !== undefined) {
      let raw: unknown;
      try {
        raw = JSON.parse(fields.mapping);
      } catch {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { mapping: ['El mapeo de columnas no es válido.'] },
        });
      }
      const parsed = scaleColumnMappingSchema.safeParse(raw);
      if (!parsed.success) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: { mapping: [parsed.error.issues[0]?.message ?? 'Mapeo no válido.'] },
        });
      }
      return { profile: null, mapping: parsed.data };
    }
    const proposed = proposeScaleMapping(headers);
    if (proposed === null) {
      throw invalidFile(
        'No reconocimos las columnas del archivo. Elige un perfil de báscula o indica qué columna es el chip, el número visual y el peso.',
      );
    }
    return { profile: null, mapping: proposed };
  }

  private parseAssociations(raw: string | undefined): ScaleAssociation[] {
    if (raw === undefined || raw.trim() === '') return [];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new DomainError('VALIDATION_FAILED', {
        fieldErrors: { associations: ['Las asociaciones de chips no son válidas.'] },
      });
    }
    const parsed = scaleAssociationsSchema.safeParse(value);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        fieldErrors: { associations: [parsed.error.issues[0]?.message ?? 'Asociación no válida.'] },
      });
    }
    return parsed.data;
  }

  /**
   * Animales activos de la finca por chip activo, chapeta activa y código normalizado (RN-30), y
   * los elegidos para chips desconocidos, que tienen que ser activos de la finca.
   */
  private async lookup(
    tx: Tx,
    scope: FarmScope,
    associations: readonly ScaleAssociation[],
  ): Promise<{ lookup: ScaleLookup; weightsOf: Map<string, WeightRecordLike[]> }> {
    const animals = await tx.animal.findMany({
      where: { farmId: scope.farmId, deletedAt: null, exitType: null },
      select: {
        id: true,
        code: true,
        name: true,
        birthDate: true,
        identifiers: {
          where: {
            retiredAt: null,
            type: { in: [IDENTIFIER_TYPE.RFID, IDENTIFIER_TYPE.VISUAL_TAG] },
          },
          select: { type: true, value: true },
        },
      },
    });
    const byRfid = new Map<string, ScaleAnimal>();
    const byVisualTag = new Map<string, ScaleAnimal>();
    const byCode = new Map<string, ScaleAnimal>();
    const byId = new Map<string, ScaleAnimal>();
    // Cada animal apunta a su lista de pesajes, que `loadWeights` llena después.
    const weightsOf = new Map<string, WeightRecordLike[]>();
    for (const row of animals) {
      const weights: WeightRecordLike[] = [];
      weightsOf.set(row.id, weights);
      const rfid =
        row.identifiers.find((identifier) => identifier.type === IDENTIFIER_TYPE.RFID)?.value ??
        null;
      const animal: ScaleAnimal = {
        id: row.id,
        code: row.code,
        name: row.name,
        birthDate: fromPrismaDate(row.birthDate),
        rfid,
        weights,
      };
      byId.set(row.id, animal);
      byCode.set(normalizeScaleCode(row.code), animal);
      for (const identifier of row.identifiers) {
        if (identifier.type === IDENTIFIER_TYPE.RFID) byRfid.set(identifier.value, animal);
        else byVisualTag.set(normalizeVisualId(identifier.value), animal);
      }
    }
    for (const association of associations) {
      if (!byId.has(association.animalId)) {
        throw new DomainError('VALIDATION_FAILED', {
          fieldErrors: {
            associations: [
              `El animal elegido para el chip ${association.chip} no está activo en esta finca.`,
            ],
          },
        });
      }
    }
    return { lookup: { byRfid, byVisualTag, byCode, byId }, weightsOf };
  }

  /** Pesajes de los animales asociados, para el aviso de atípico (PES-01). */
  private async loadWeights(
    tx: Tx,
    scope: FarmScope,
    weightsOf: Map<string, WeightRecordLike[]>,
    animalIds: readonly string[],
  ): Promise<void> {
    const ids = [...new Set(animalIds)];
    if (ids.length === 0) return;
    const rows = await tx.weightRecord.findMany({
      where: { farmId: scope.farmId, animalId: { in: ids } },
      select: WEIGHT_LIKE_SELECT,
    });
    for (const row of rows) weightsOf.get(row.animalId)?.push(toWeightLike(row));
  }

  /**
   * ¿Se guarda el chip asociado como RFID del animal? (PES-04 CA3, decisión de M6). Sí por
   * defecto, con las reglas de siempre (`checkIdentifier`: RN-19, RN-32). No, con un aviso, si el
   * animal ya tiene otro chip activo o si el chip no se puede asignar (lo tiene un animal que
   * salió, o perteneció a otro animal y hace falta que un ADMIN lo confirme desde la ficha).
   */
  private async chipDecisions(
    tx: Tx,
    scope: FarmScope,
    lookup: ScaleLookup,
    associations: readonly ScaleAssociation[],
    plan: ScaleImportPlan,
  ): Promise<{ notices: ChipAssociationNotice[]; toSave: ScaleAssociation[] }> {
    const used = new Set(
      plan.rows.filter((row) => row.via === 'ASSOCIATED').map((row) => row.eid ?? ''),
    );
    const notices: ChipAssociationNotice[] = [];
    const toSave: ScaleAssociation[] = [];
    for (const association of associations) {
      if (!association.saveChip || !used.has(association.chip)) continue;
      const animal = lookup.byId.get(association.animalId);
      if (animal === undefined) continue;
      if (animal.rfid !== null && animal.rfid !== association.chip) {
        notices.push({
          chip: association.chip,
          animalId: animal.id,
          message: `Este animal ya tiene el chip ${animal.rfid}: revisa la asociación.`,
        });
        continue;
      }
      try {
        await checkIdentifier(tx, scope, {
          type: IDENTIFIER_TYPE.RFID,
          value: association.chip,
          animalId: animal.id,
        });
        toSave.push(association);
      } catch (error) {
        if (!isDomainError(error)) throw error;
        notices.push({
          chip: association.chip,
          animalId: animal.id,
          message: `El chip no se guardará en ${animal.code}: ${error.detail}`,
        });
      }
    }
    return { notices, toSave };
  }

  // -------------------------------------------------------------------------------------------
  // Escritura
  // -------------------------------------------------------------------------------------------

  private async write(
    tx: Tx,
    scope: FarmScope,
    input: {
      analysis: Analysis;
      fileName: string;
      hash: string;
      importKey: string;
      at: Date;
    },
  ): Promise<WeightImportResult> {
    const { analysis, at } = input;
    const { plan } = analysis;
    const userId = userOf(scope);
    const dates = plan.weights.map((item) => item.date).sort();
    const sessionDate = dates.at(-1) ?? this.clock.today();

    // PES-04 CA4: una jornada de pesaje, ya cerrada, con un pesaje por animal.
    const workSessionId = uuidv7();
    await tx.workSession.create({
      data: {
        id: workSessionId,
        farmId: scope.farmId,
        name: `Pesaje de báscula del ${formatDate(sessionDate)}`,
        sessionDate: toPrismaDate(sessionDate),
        activities: [
          { type: WORK_SESSION_ACTIVITY.WEIGHT, source: WEIGHT_SOURCE.SCALE_FILE },
        ] as Prisma.InputJsonArray,
        status: 'CLOSED',
        closedAt: at,
        createdById: userId,
        createdAt: at,
        updatedAt: at,
      },
    });
    const weightRows = plan.weights.map((item) => ({
      id: uuidv7(),
      farmId: scope.farmId,
      animalId: item.animalId,
      weighedOn: toPrismaDate(item.date),
      weightKg: new Prisma.Decimal(item.weightKg),
      method: WEIGHT_METHOD.SCALE,
      isBirthWeight: false,
      identifiedBy: IDENTIFIED_BY.IMPORT,
      weightSource: WEIGHT_SOURCE.SCALE_FILE,
      workSessionId,
      notes: null,
      createdById: userId,
      createdAt: at,
      updatedAt: at,
    }));
    await tx.weightRecord.createMany({ data: weightRows });
    await tx.workSessionEntry.createMany({
      data: [...new Set(plan.weights.map((item) => item.animalId))].map((animalId) => ({
        id: uuidv7(),
        workSessionId,
        animalId,
        processedAt: at,
        createdById: userId,
      })),
      skipDuplicates: true,
    });

    for (const association of analysis.chipsToSave) {
      const identifierId = uuidv7();
      await tx.identifier.create({
        data: {
          id: identifierId,
          farmId: scope.farmId,
          animalId: association.animalId,
          type: IDENTIFIER_TYPE.RFID,
          value: association.chip,
          assignedAt: toPrismaDate(sessionDate),
          createdAt: at,
        },
      });
      await tx.auditLog.create({
        data: {
          farmId: scope.farmId,
          userId,
          entity: 'Identifier',
          entityId: identifierId,
          action: AUDIT_ACTION.CREATE,
          diff: {
            after: {
              animalId: association.animalId,
              type: IDENTIFIER_TYPE.RFID,
              value: association.chip,
              source: 'Importación de la báscula',
            },
          },
          createdAt: at,
        },
      });
    }

    const batchId = uuidv7();
    const notCreated = analysis.totalRows - weightRows.length;
    await tx.importBatch.create({
      data: {
        id: batchId,
        farmId: scope.farmId,
        kind: IMPORT_KIND.WEIGHTS,
        idempotencyKey: input.importKey,
        fileSha256: input.hash,
        fileName: input.fileName,
        workSessionId,
        totalRows: analysis.totalRows,
        createdRows: weightRows.length,
        errorRows: plan.counts.errors,
        summary: {
          profile: analysis.profile?.id ?? null,
          unit: analysis.mapping.unit,
          duplicates: plan.counts.duplicates,
          outliers: plan.counts.outliers,
          unknownChips: plan.unknownChips.map((chip) => chip.chip),
          skipped: plan.counts.skipped,
          chipsSaved: analysis.chipsToSave.length,
        },
        createdById: userId,
        createdAt: at,
      },
    });
    await tx.auditLog.createMany({
      data: [
        {
          farmId: scope.farmId,
          userId,
          entity: 'ImportBatch',
          entityId: batchId,
          action: AUDIT_ACTION.IMPORT,
          diff: {
            after: {
              kind: IMPORT_KIND.WEIGHTS,
              fileName: input.fileName,
              created: weightRows.length,
              workSessionId,
            },
          },
          createdAt: at,
        },
        ...weightRows.map((row) => ({
          farmId: scope.farmId,
          userId,
          entity: 'WeightRecord',
          entityId: row.id,
          action: AUDIT_ACTION.CREATE,
          diff: {
            after: {
              animalId: row.animalId,
              weighedOn: fromPrismaDate(row.weighedOn),
              weightKg: Number(row.weightKg),
              importBatchId: batchId,
            },
          },
          createdAt: at,
        })),
      ],
    });

    return {
      importBatchId: batchId,
      workSessionId,
      created: weightRows.length,
      skipped: notCreated,
      chipsSaved: analysis.chipsToSave.length,
      replayed: false,
    };
  }
}
