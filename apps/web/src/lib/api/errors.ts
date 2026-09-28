import { ERROR_CATALOG, errorDetail, type ErrorCode } from '@hato/shared';

/**
 * Errores del cliente de la API.
 *
 * La API responde `application/problem+json` con un `code` estable y un `detail` en español
 * listo para mostrar (CLAUDE.md, regla 10). Aquí se convierte en un `ApiError` para que la
 * interfaz decida por `code` y muestre `detail` sin interpretar textos.
 */

/**
 * Código que existe solo en el cliente: la API no respondió (sin red, tiempo agotado o un
 * intermediario como el proxy de Vite o Caddy que responde sin problem+json porque la API
 * está caída). No está en el catálogo de `@hato/shared` porque la API nunca lo envía.
 */
export const NETWORK_ERROR = 'NETWORK_ERROR';

/** Mensaje de `NETWORK_ERROR`, en el tono de 06-ux-ui.md §7. */
export const NETWORK_ERROR_DETAIL =
  'No hay conexión con el servidor. Revisa la señal e intenta de nuevo.';

/** Código de un `ApiError`: uno del catálogo, o el de red del cliente. */
export type ApiErrorCode = ErrorCode | typeof NETWORK_ERROR;

/** Errores por campo, tal como los envía la API en `VALIDATION_FAILED`. */
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

/** Error de una petición a la API, con el código estable y el mensaje para mostrar. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly detail: string;
  readonly fieldErrors: FieldErrors | undefined;
  /** Datos del caso que manda la API en `context` (por ejemplo, `animalId` y `animalCode`). */
  readonly context: Readonly<Record<string, string>> | undefined;

  constructor(input: {
    status: number;
    code: ApiErrorCode;
    detail: string;
    fieldErrors?: FieldErrors | undefined;
    context?: Readonly<Record<string, string>> | undefined;
    cause?: unknown;
  }) {
    super(input.detail, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.detail = input.detail;
    this.fieldErrors = input.fieldErrors;
    this.context = input.context;
  }
}

/** ¿El valor es un `ApiError`? */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** ¿Es un código del catálogo de `@hato/shared`? */
export function isCatalogCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}

/** Error de red: la petición no llegó a la API o no hubo respuesta a tiempo. */
export function networkError(cause?: unknown): ApiError {
  return new ApiError({ status: 0, code: NETWORK_ERROR, detail: NETWORK_ERROR_DETAIL, cause });
}

/**
 * Convierte una respuesta fallida en `ApiError`.
 *
 * - problem+json con un código conocido: se respeta el `detail` del servidor, que puede traer
 *   datos concretos («Ya existe un animal con el código P-12»), y los errores por campo.
 * - Sin problem+json y con estado 5xx: la API no fue quien respondió (el proxy o Caddy con la
 *   API caída), así que se trata como falta de conexión.
 * - Cualquier otro caso: error inesperado con el mensaje del catálogo.
 */
export async function toApiError(response: Response): Promise<ApiError> {
  const body = await readProblem(response);

  if (body !== null && isCatalogCode(body.code)) {
    return new ApiError({
      status: response.status,
      code: body.code,
      detail:
        typeof body.detail === 'string' && body.detail !== ''
          ? body.detail
          : errorDetail(body.code),
      fieldErrors: isFieldErrors(body.errors) ? body.errors : undefined,
      context: isContext(body.context) ? body.context : undefined,
    });
  }

  if (body === null && response.status >= 500) return networkError();

  return new ApiError({
    status: response.status,
    code: 'INTERNAL_ERROR',
    detail: errorDetail('INTERNAL_ERROR'),
  });
}

type ProblemBody = { code?: unknown; detail?: unknown; errors?: unknown; context?: unknown };

async function readProblem(response: Response): Promise<ProblemBody | null> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? body : null;
  } catch {
    return null;
  }
}

function isContext(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isFieldErrors(value: unknown): value is FieldErrors {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every(
    (messages) => Array.isArray(messages) && messages.every((item) => typeof item === 'string'),
  );
}
