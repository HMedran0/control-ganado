import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '@hato/shared';

import type { FarmScope, RequestWithScope } from './farm-scope.types.js';

/**
 * Inyecta el ámbito de la petición en un controlador: `metodo(@CurrentScope() scope: FarmScope)`.
 *
 * Si el ámbito no está resuelto es un error de programación (falta el guard), no un problema
 * del cliente: se responde 403 en lugar de exponer datos sin filtrar.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): FarmScope => {
    const request = context.switchToHttp().getRequest<RequestWithScope>();
    if (request.scope === undefined) {
      throw new DomainError('FORBIDDEN_ROLE', {
        detail: 'La petición no tiene una finca asociada.',
      });
    }
    return request.scope;
  },
);
