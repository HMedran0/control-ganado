import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import {
  DomainError,
  ROLE,
  animalImportConfirmFieldsSchema,
  animalImportPreviewFieldsSchema,
  type AnimalImportPreview,
  type AnimalImportResultView,
} from '@hato/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AnimalImportService } from './animal-import.service.js';
import { buildErrorsWorkbook, buildTemplate, XLSX_CONTENT_TYPE } from './import-workbooks.js';
import { readUpload } from './upload.js';

/**
 * Importación del inventario (05-api.md «Importación», ANI-09 CA7: solo ADMIN). El decorador a
 * nivel de clase evita que un endpoint nuevo quede abierto por olvido.
 */
@Roles(ROLE.ADMIN)
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: AnimalImportService,
    private readonly prisma: PrismaService,
  ) {}

  /** Plantilla con las listas del catálogo de la finca (CA1). */
  @Get('animals/template')
  async template(
    @CurrentScope() scope: FarmScope,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const [breeds, lots] = await Promise.all([
      this.prisma.breed.findMany({
        where: { farmId: scope.farmId, isActive: true },
        orderBy: { name: 'asc' },
        select: { name: true },
      }),
      this.prisma.lot.findMany({
        where: { farmId: scope.farmId, isActive: true },
        orderBy: { name: 'asc' },
        select: { name: true },
      }),
    ]);
    attachment(reply, 'plantilla-importacion-hato.xlsx');
    return buildTemplate({
      breeds: breeds.map((item) => item.name),
      lots: lots.map((item) => item.name),
    });
  }

  /**
   * `?dryRun=true`: simulación, no guarda nada (CA3). Sin él, importa las filas válidas en una
   * transacción, una sola vez por `importKey` (CA5, ADR-011).
   */
  @Post('animals')
  @HttpCode(201)
  async importAnimals(
    @Query('dryRun') dryRun: string | undefined,
    @CurrentScope() scope: FarmScope,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AnimalImportPreview | AnimalImportResultView> {
    const { file, fields } = await readUpload(request);
    if (dryRun === 'true') {
      reply.status(200);
      return this.imports.preview(
        scope,
        file,
        parseFields(animalImportPreviewFieldsSchema, fields),
      );
    }
    const result = await this.imports.confirm(
      scope,
      file,
      parseFields(animalImportConfirmFieldsSchema, fields),
    );
    if (result.replayed) reply.status(200);
    return result;
  }

  /** Las filas con error del archivo, con una columna «Error», para corregirlas (CA5). */
  @Post('animals/errors')
  @HttpCode(200)
  async errors(
    @CurrentScope() scope: FarmScope,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { file, fields } = await readUpload(request);
    const { rows } = await this.imports.errorRows(
      scope,
      file,
      parseFields(animalImportPreviewFieldsSchema, fields),
    );
    attachment(reply, 'filas-con-error.xlsx');
    return buildErrorsWorkbook(rows);
  }
}

/** Valida los campos de texto del formulario con su esquema de shared. */
function parseFields<T>(schema: ZodType<T>, fields: Record<string, string>): T {
  const parsed = schema.safeParse(fields);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || 'form';
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  throw new DomainError('VALIDATION_FAILED', { fieldErrors });
}

/** Descarga de un libro de Excel, sin caché. */
function attachment(reply: FastifyReply, fileName: string): void {
  reply.header('content-type', XLSX_CONTENT_TYPE);
  reply.header('content-disposition', `attachment; filename="${fileName}"`);
  reply.header('cache-control', 'no-store');
}
