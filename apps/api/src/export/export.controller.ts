import type { PassThrough } from 'node:stream';

import { Controller, Get, Res } from '@nestjs/common';
import { ROLE } from '@hato/shared';
import type { FastifyReply } from 'fastify';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { FullExportService, ZIP_CONTENT_TYPE } from './full-export.service.js';

/** Exportación completa de la finca (BAK-02, ADR-018). Solo el ADMIN. */
@Controller('export')
@Roles(ROLE.ADMIN)
export class ExportController {
  constructor(private readonly exporter: FullExportService) {}

  /**
   * Un ZIP con un Excel por entidad y un `LEEME.txt`, escrito mientras se descarga. Antes de
   * responder pasa el candado global, el límite de 3 por hora y la auditoría; un error ahí es un
   * 429 con `Retry-After`.
   */
  @Get('full')
  async full(
    @CurrentScope() scope: FarmScope,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PassThrough> {
    const { fileName, stream } = await this.exporter.start(scope);
    reply.header('content-type', ZIP_CONTENT_TYPE);
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    reply.header('cache-control', 'no-store');
    return stream;
  }
}
