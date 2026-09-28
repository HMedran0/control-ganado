import { Controller, Get, Query } from '@nestjs/common';
import { ROLE, auditQuerySchema, type AuditPage, type AuditQuery } from '@hato/shared';

import { CurrentScope } from '../common/farm-scope/farm-scope.decorator.js';
import type { FarmScope } from '../common/farm-scope/farm-scope.types.js';
import { Roles } from '../common/roles/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';

/** Auditoría (05-api.md «Auditoría», AUD-01 CA2). Solo ADMIN. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(ROLE.ADMIN)
  list(
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
    @CurrentScope() scope: FarmScope,
  ): Promise<AuditPage> {
    return this.audit.list(scope, query);
  }
}
