import { Module } from '@nestjs/common';

import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** Consulta de la auditoría (M4c). La escritura la hace cada caso de uso en su transacción. */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
