import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '@hato/shared';
import type { Logger } from 'pino';
import { tap, type Observable } from 'rxjs';

import { LOGGER } from '../../infra/logger.js';
import { PrismaService } from '../../infra/prisma.service.js';
import type { RequestWithScope } from '../farm-scope/farm-scope.types.js';
import { AUDIT_KEY, type AuditMetadata } from './audit.decorator.js';

/**
 * Registra en `audit_logs` cada escritura **exitosa** (04-arquitectura.md §4).
 *
 * Se apoya en `@Audit` para saber la entidad y la acción, y saca el `entityId` del cuerpo de la
 * respuesta. Si el endpoint falla, el `tap` no se ejecuta y no se registra nada: la auditoría
 * cuenta lo que pasó, no lo que se intentó.
 *
 * Un fallo al escribir la auditoría no tumba la petición —el trabajo de negocio ya se hizo—,
 * pero se registra en el log para que no pase inadvertido.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler());
    if (metadata === undefined) return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithScope>();

    return next.handle().pipe(
      tap((response: unknown) => {
        const scope = request.scope;
        if (scope === undefined) return;
        const entityId = extractId(response);
        if (entityId === null) {
          this.logger.warn(
            { entity: metadata.entity, action: metadata.action },
            'Escritura auditable sin id en la respuesta: no se registró en la auditoría',
          );
          return;
        }

        void this.record(metadata, scope.farmId, scope.userId, entityId, response);
      }),
    );
  }

  private async record(
    metadata: AuditMetadata,
    farmId: string,
    userId: string | null,
    entityId: string,
    response: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          farmId,
          userId,
          entity: metadata.entity,
          entityId,
          action: metadata.action,
          diff: toDiff(response),
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, entity: metadata.entity, entityId, action: metadata.action },
        'No se pudo registrar la auditoría',
      );
    }
  }
}

/** `id` del recurso afectado, tomado del cuerpo de la respuesta. */
function extractId(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const id: unknown = (response as { id?: unknown }).id;
  return typeof id === 'string' && isUuid(id) ? id : null;
}

/** Diff que se guarda en la auditoría: por ahora, el recurso resultante. */
function toDiff(response: unknown): object | undefined {
  return typeof response === 'object' && response !== null ? response : undefined;
}
