/**
 * Catálogo de errores y advertencias de la API (docs/05-api.md, «Catálogo de códigos de error»).
 *
 * El `code` es estable y la `detail` está en español de Colombia, lista para mostrar
 * (CLAUDE.md, regla 10). Los textos entre llaves se reemplazan con `errorDetail`.
 */

/** Definición de un error: estado HTTP y mensaje por defecto. */
export type ErrorDefinition = {
  readonly status: number;
  readonly detail: string;
};

/** Valores para reemplazar los marcadores `{...}` del mensaje. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** Errores bloqueantes. El estado HTTP es el que devuelve la API. */
export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 422, detail: 'Revisa los campos marcados.' },
  AUTH_INVALID_CREDENTIALS: { status: 401, detail: 'Usuario o contraseña incorrectos.' },
  AUTH_ACCOUNT_LOCKED: {
    status: 423,
    detail: 'La cuenta está bloqueada por intentos fallidos. Intenta de nuevo en 15 minutos.',
  },
  AUTH_PASSWORD_CHANGE_REQUIRED: {
    status: 403,
    detail: 'Debes cambiar tu contraseña temporal.',
  },
  AUTH_TOKEN_EXPIRED: { status: 401, detail: 'La sesión expiró. Vuelve a iniciar sesión.' },
  /** Tope absoluto de la sesión deslizante (AUT-10 CA2). Trae `context.login`. */
  AUTH_SESSION_MAX_AGE: {
    status: 401,
    detail: 'Por seguridad, vuelve a escribir tu contraseña.',
  },
  FORBIDDEN_ROLE: { status: 403, detail: 'Tu rol no permite esta acción.' },
  NOT_FOUND: { status: 404, detail: 'El registro no existe o no pertenece a esta finca.' },
  VERSION_CONFLICT: {
    status: 409,
    detail: 'Otra persona modificó este registro. Recarga para ver los cambios.',
  },
  USERNAME_TAKEN: { status: 409, detail: 'Ya existe un usuario con ese nombre.' },
  LAST_ADMIN: { status: 409, detail: 'La finca debe tener al menos un administrador activo.' },
  CATALOG_NAME_TAKEN: { status: 409, detail: 'Ya existe {what} con el nombre «{name}».' },
  SYSTEM_TAG_PROTECTED: {
    status: 409,
    detail: 'La etiqueta «{label}» es del sistema: no se puede desactivar ni cambiar su nombre.',
  },
  ANIMAL_CODE_TAKEN: { status: 409, detail: 'Ya existe un animal con el código {code}.' },
  ANIMAL_EXITED: {
    status: 409,
    detail: 'El animal ya salió de la finca; revierte la salida para modificarlo.',
  },
  ANIMAL_ARCHIVED: { status: 409, detail: 'El animal está archivado.' },
  IDENTIFIER_TAKEN: {
    status: 409,
    detail: 'El identificador {value} ya está asignado al animal {code}.',
  },
  IDENTIFIER_PREVIOUSLY_USED: {
    status: 409,
    detail:
      'El identificador {value} perteneció al animal {code}. Solo un administrador puede reasignarlo.',
  },
  IDENTIFIER_INVALID_RFID: {
    status: 422,
    detail: 'El código RFID debe tener exactamente 15 dígitos.',
  },
  SEX_NOT_ALLOWED: { status: 422, detail: 'Esta acción solo aplica a hembras.' },
  PREGNANCY_ALREADY_OPEN: { status: 409, detail: 'La hembra ya tiene una preñez abierta.' },
  PREGNANCY_NOT_OPEN: { status: 409, detail: 'La hembra no tiene una preñez abierta.' },
  /** Anular un parto con crías vivas activas (M5): primero se archivan las crías. */
  PREGNANCY_HAS_CALVES: { status: 409, detail: 'Archiva primero las crías de este parto.' },
  DATE_IN_FUTURE: { status: 422, detail: 'La fecha no puede ser posterior a hoy.' },
  DATE_BEFORE_BIRTH: { status: 422, detail: 'La fecha es anterior al nacimiento del animal.' },
  CALVES_COUNT_INVALID: { status: 422, detail: 'Un parto puede registrar de 1 a 3 crías.' },
  VACCINE_SEX_BLOCKED: { status: 422, detail: 'La vacuna {vaccine} no se aplica a {sex}.' },
  WITHDRAWAL_ACTIVE: {
    status: 409,
    detail: 'El animal está en retiro hasta {date}. Confirma para continuar.',
  },
  SALE_AMOUNT_REQUIRED: { status: 422, detail: 'Indica el precio de venta.' },
  ALLOCATION_EMPTY: {
    status: 422,
    detail: 'Selecciona al menos un animal para repartir el gasto.',
  },
  ALLOCATION_NO_WEIGHT: {
    status: 422,
    detail: 'Hay animales sin peso registrado; usa reparto en partes iguales.',
  },
  /** ECO-01 (M7): la compra se registra en el formulario del animal, no como gasto suelto. */
  EXPENSE_PURCHASE_FROM_ANIMAL: {
    status: 422,
    detail: 'El valor de compra se registra en la ficha del animal, al crearlo o editarlo.',
  },
  /** ECO-01 (M7): un gasto anulado no se corrige; se registra otro. */
  EXPENSE_VOIDED: { status: 409, detail: 'Este gasto está anulado: registra uno nuevo.' },
  /** ECO-04 (M7): una venta anulada (se revirtió la salida) no se corrige. */
  SALE_VOIDED: {
    status: 409,
    detail: 'Esta venta está anulada porque se revirtió la salida del animal.',
  },
  /** ECO-03 (M7): avalúo por precio por kilo sin precio para la categoría del animal. */
  VALUATION_NO_PRICE: {
    status: 422,
    detail:
      'No hay precio por kilo para la categoría {category}. Configúralo en Configuración → Finca.',
  },
  /** ECO-03 (M7): avalúo por precio por kilo de un animal sin pesajes. */
  VALUATION_NO_WEIGHT: {
    status: 422,
    detail: 'El animal no tiene pesajes: registra un peso o pon el valor a mano.',
  },
  WORK_SESSION_CLOSED: { status: 409, detail: 'La jornada ya fue cerrada.' },
  IMPORT_FILE_INVALID: { status: 422, detail: 'El archivo no tiene el formato de la plantilla.' },
  IMPORT_TOO_MANY_ROWS: { status: 413, detail: 'El archivo supera las 5.000 filas.' },
  IMPORT_FILE_TOO_LARGE: { status: 413, detail: 'El archivo supera los 5 MB.' },
  /** PES-04: el archivo de la báscula no se pudo leer con el perfil elegido. */
  SCALE_FILE_INVALID: {
    status: 422,
    detail: 'No pudimos leer el archivo de la báscula. Revisa el formato o el perfil de báscula.',
  },
  /** PES-04: las plantillas del sistema no se editan; se duplican. */
  SYSTEM_TEMPLATE_READONLY: {
    status: 409,
    detail: 'Esta plantilla es del sistema y no se edita. Duplícala para ajustarla a tu báscula.',
  },
  /** ADR-012 §1: el `id` que envió el cliente ya existe con otros datos o en otra finca. */
  CLIENT_ID_CONFLICT: {
    status: 409,
    detail: 'Ya existe un registro con ese identificador y otros datos.',
  },
  /** ADR-012 §2: la misma `Idempotency-Key` llegó con otra ruta u otro cuerpo. */
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    detail: 'Esa clave de reintento ya se usó para otra operación.',
  },
  /** ADR-013: reservado; con el plan PILOT nada lo lanza en la fase 1. */
  PLAN_LIMIT_REACHED: { status: 403, detail: 'Tu plan no permite más {what}.' },
  CODE_REASSIGNED: {
    status: 409,
    detail:
      'El código {code} ya lo tiene el animal activo {holder}. Asígnale un código nuevo para revertir la salida.',
  },
  CODE_REUSE_CONFLICT: {
    status: 409,
    detail:
      'Hay números repetidos entre animales activos y animales que salieron ({codes}). Cámbialos antes de desactivar la reutilización.',
  },
  /** BAK-02 (M8b, ADR-018): tres exportaciones completas por hora y por finca. Con `Retry-After`. */
  EXPORT_LIMIT_REACHED: {
    status: 429,
    detail:
      'Ya se exportaron los datos de la finca 3 veces en la última hora. Intenta de nuevo en {minutes} minutos.',
  },
  /** BAK-02 (ADR-018): una exportación completa a la vez en todo el servidor. Con `Retry-After`. */
  EXPORT_IN_PROGRESS: {
    status: 429,
    detail: 'Hay otra exportación en curso; intenta en un minuto.',
  },
  RATE_LIMITED: { status: 429, detail: 'Demasiadas solicitudes. Espera un momento.' },
  INTERNAL_ERROR: { status: 500, detail: 'Ocurrió un error inesperado. Ya quedó registrado.' },
} as const satisfies Record<string, ErrorDefinition>;

/** Código de error estable. */
export type ErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Advertencias no bloqueantes. Viajan en la respuesta exitosa como
 * `warnings: [{ code, message }]` (docs/05-api.md).
 */
export const WARNING_CATALOG = {
  WEIGHT_OUTLIER: 'El peso {weight} kg se aleja mucho del último registrado. Verifícalo.',
  RFID_FOREIGN_COUNTRY:
    'El código RFID no empieza por 170 (Colombia); parece de un animal importado.',
  BREEDING_AGE_LOW: 'La hembra tiene {age} y la edad mínima de servicio es {minAge}.',
  DAM_AGE_LOW:
    'La madre {code} tenía {age} al nacer la cría; la edad mínima reproductiva es {minAge}.',
  VACCINE_AGE_OUTSIDE_WINDOW:
    'El animal está fuera de la edad recomendada para la vacuna {vaccine}.',
  ALREADY_IN_SESSION: 'Este animal ya fue registrado en la jornada.',
  CYCLE_OVERLAP: 'Las fechas se cruzan con el ciclo {name} ({from} a {to}).',
  LOT_HAS_ACTIVE_ANIMALS: '{count} animales siguen en este lote.',
  VACCINE_IN_ACTIVE_CYCLE:
    'La vacuna está en el ciclo {name} ({from} a {to}), en curso o por empezar.',
  IDENTIFIER_NOT_RESTORED:
    'El identificador {value} ya lo tiene el animal {code}: quedó retirado en este animal.',
  /** Cambió la gestación de una raza, de la finca o la raza de una madre (RN-04, M5). */
  EXPECTED_CALVING_RECALCULATED: 'Se recalculó el parto estimado de {count} preñeces abiertas.',
  /** PES-04: el mismo animal dos veces el mismo día en el archivo; se conserva el último. */
  SCALE_DUPLICATE_READING:
    'El animal {code} aparece {count} veces el {date}: se guarda el último peso ({weight} kg).',
} as const satisfies Record<string, string>;

/** Código de advertencia estable. */
export type WarningCode = keyof typeof WARNING_CATALOG;

/** Advertencia lista para la respuesta de la API. */
export type Warning = {
  readonly code: WarningCode;
  readonly message: string;
};

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

function interpolate(template: string, params: MessageParams | undefined): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/** Estado HTTP de un código de error. */
export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CATALOG[code].status;
}

/** Mensaje en español de un error, con los marcadores reemplazados. */
export function errorDetail(code: ErrorCode, params?: MessageParams): string {
  return interpolate(ERROR_CATALOG[code].detail, params);
}

/** Mensaje en español de una advertencia, con los marcadores reemplazados. */
export function warningMessage(code: WarningCode, params?: MessageParams): string {
  return interpolate(WARNING_CATALOG[code], params);
}

/** Construye una advertencia lista para la respuesta. */
export function warning(code: WarningCode, params?: MessageParams): Warning {
  return { code, message: warningMessage(code, params) };
}

/**
 * Datos del caso que la interfaz necesita para ofrecer la salida, además del mensaje. Por
 * ejemplo, en `IDENTIFIER_TAKEN`, qué animal tiene el identificador, para enlazar a su ficha.
 * Viaja en `problem+json` como `context`.
 */
export type ErrorContext = Readonly<Record<string, string>>;

/** Opciones de `DomainError`. */
export type DomainErrorOptions = {
  /** Valores para los marcadores del mensaje del catálogo. */
  readonly params?: MessageParams;
  /** Reemplaza por completo el mensaje del catálogo (por ejemplo, `SEX_NOT_ALLOWED`). */
  readonly detail?: string;
  /** Errores por campo, para `VALIDATION_FAILED`. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  /** Causa original, si este error envuelve otro. */
  readonly cause?: unknown;
  /** Datos del caso para la interfaz (ver `ErrorContext`). */
  readonly context?: ErrorContext;
  /** Segundos para reintentar: la API los manda en la cabecera `Retry-After` (429). */
  readonly retryAfterSeconds?: number;
};

/**
 * Error de negocio con código estable. La API lo traduce a `application/problem+json`
 * usando `code`, `status` y `detail` sin tener que reinterpretar el mensaje.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>> | undefined;
  readonly context: ErrorContext | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, options: DomainErrorOptions = {}) {
    const detail = options.detail ?? errorDetail(code, options.params);
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.detail = detail;
    this.fieldErrors = options.fieldErrors;
    this.context = options.context;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** ¿El valor es un `DomainError`? Útil en los filtros de excepciones de la API. */
export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/**
 * Advertencia del recálculo del parto estimado (RN-04, M5), con el número en singular o plural y
 * las preñeces que se dejaron quietas porque alguien corrigió su parto estimado a mano.
 */
export function expectedCalvingRecalculatedWarning(count: number, skippedManual: number): Warning {
  const main =
    count === 1
      ? 'Se recalculó el parto estimado de 1 preñez abierta.'
      : warningMessage('EXPECTED_CALVING_RECALCULATED', { count });
  const skipped =
    skippedManual === 0
      ? ''
      : skippedManual === 1
        ? ' 1 preñez con el parto corregido a mano no se tocó.'
        : ` ${skippedManual} preñeces con el parto corregido a mano no se tocaron.`;
  return { code: 'EXPECTED_CALVING_RECALCULATED', message: main + skipped };
}

/**
 * Advertencia de lote con animales activos, con el verbo en singular o plural:
 * «1 animal sigue en este lote.», «12 animales siguen en este lote.»
 */
export function lotHasActiveAnimalsWarning(count: number): Warning {
  return {
    code: 'LOT_HAS_ACTIVE_ANIMALS',
    message:
      count === 1
        ? '1 animal sigue en este lote.'
        : warningMessage('LOT_HAS_ACTIVE_ANIMALS', { count }),
  };
}
