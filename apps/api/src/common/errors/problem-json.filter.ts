import {
  Catch,
  HttpException,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ERROR_CATALOG, errorDetail, isDomainError, type ErrorCode } from '@hato/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { problemTypeFor, type ProblemDetails } from './problem.types.js';

/** Títulos en español por estado HTTP, para el campo `title` de la RFC 9457. */
const TITLE_BY_STATUS: Record<number, string> = {
  400: 'Petición incorrecta',
  401: 'No autenticado',
  403: 'Sin permiso',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Contenido demasiado grande',
  422: 'Datos inválidos',
  423: 'Cuenta bloqueada',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
};

function titleFor(status: number): string {
  return TITLE_BY_STATUS[status] ?? 'Error';
}

/**
 * Traduce cualquier excepción a `application/problem+json`.
 *
 * Tres caminos:
 *   1. `DomainError` de `@hato/shared`: su `code`, `status` y `detail` pasan tal cual, así que
 *      las reglas de negocio definen el mensaje una sola vez y en un solo idioma.
 *   2. `HttpException` de NestJS (404 de ruta desconocida, 400 de parseo): se asigna el código
 *      del catálogo que corresponde al estado.
 *   3. Cualquier otra cosa: 500 `INTERNAL_ERROR`. El mensaje interno **no** viaja al cliente;
 *      se registra con el `requestId` para poder cruzarlo con el log (04-arquitectura.md §11).
 */
@Catch()
@Injectable()
export class ProblemJsonFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, requestId: problem.requestId, code: problem.code },
        'Error no controlado',
      );
    } else {
      this.logger.warn(
        { requestId: problem.requestId, code: problem.code, status: problem.status },
        problem.detail,
      );
    }

    void reply.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemDetails {
    const requestId = typeof request.id === 'string' ? request.id : undefined;
    const instance = request.url;

    if (isDomainError(exception)) {
      return {
        type: problemTypeFor(exception.code),
        title: titleFor(exception.status),
        status: exception.status,
        detail: exception.detail,
        code: exception.code,
        instance,
        ...(exception.fieldErrors === undefined ? {} : { errors: exception.fieldErrors }),
        ...(requestId === undefined ? {} : { requestId }),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = codeForStatus(status);
      return {
        type: problemTypeFor(code),
        title: titleFor(status),
        status,
        detail: detailForHttpException(exception, code),
        code,
        instance,
        ...(requestId === undefined ? {} : { requestId }),
      };
    }

    // Errores de Fastify y sus complementos (límite de peticiones, cuerpo ilegible, cuerpo
    // demasiado grande). No son `HttpException`, pero traen su estado: sin este caso, un
    // 429 del limitador llegaría al cliente como un 500 sin código útil.
    const status = fastifyStatus(exception);
    if (status !== null && status < 500) {
      const code = codeForStatus(status);
      return {
        type: problemTypeFor(code),
        title: titleFor(status),
        status,
        detail: errorDetail(code),
        code,
        instance,
        ...(requestId === undefined ? {} : { requestId }),
      };
    }

    return {
      type: problemTypeFor('INTERNAL_ERROR'),
      title: titleFor(500),
      status: 500,
      detail: errorDetail('INTERNAL_ERROR'),
      code: 'INTERNAL_ERROR',
      instance,
      ...(requestId === undefined ? {} : { requestId }),
    };
  }
}

/** Estado HTTP de un error de Fastify, que lo lleva en `statusCode`. */
function fastifyStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { statusCode } = exception as { statusCode?: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : null;
}

/** Código del catálogo que corresponde a un estado HTTP de NestJS. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'AUTH_TOKEN_EXPIRED';
    case 403:
      return 'FORBIDDEN_ROLE';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'VERSION_CONFLICT';
    case 413:
      return 'IMPORT_TOO_MANY_ROWS';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
  }
}

/**
 * Mensaje de una `HttpException`. Se prefiere el del catálogo, en español; el de NestJS viene
 * en inglés («Cannot GET /x») y no se muestra al usuario.
 */
function detailForHttpException(exception: HttpException, code: ErrorCode): string {
  const response: unknown = exception.getResponse();
  if (typeof response === 'object' && response !== null && 'detail' in response) {
    const { detail } = response;
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return ERROR_CATALOG[code].detail;
}
