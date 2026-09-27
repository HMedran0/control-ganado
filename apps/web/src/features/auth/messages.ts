import { errorDetail } from '@hato/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { isApiError, NETWORK_ERROR_DETAIL } from '../../lib/api/errors';

/**
 * Mensaje general para un error del inicio de sesión.
 *
 * Para los casos que la persona debe entender sin ambigüedad se usa el texto del catálogo de
 * `@hato/shared`, no el que envió el servidor: así la pantalla no cambia si mañana la API
 * reformula un `detail`.
 */
export function loginErrorMessage(error: unknown): string {
  if (!isApiError(error)) return errorDetail('INTERNAL_ERROR');
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
    case 'AUTH_ACCOUNT_LOCKED':
    case 'RATE_LIMITED':
      return errorDetail(error.code);
    case 'NETWORK_ERROR':
      return NETWORK_ERROR_DETAIL;
    default:
      return error.detail;
  }
}

/**
 * Pasa a los campos del formulario los errores por campo de un `VALIDATION_FAILED`.
 *
 * @returns `true` si al menos uno correspondía a un campo del formulario.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
): boolean {
  if (!isApiError(error) || error.fieldErrors === undefined) return false;
  let applied = false;
  for (const field of fields) {
    const message = error.fieldErrors[field]?.[0];
    if (message === undefined) continue;
    setError(field, { type: 'server', message });
    applied = true;
  }
  return applied;
}
