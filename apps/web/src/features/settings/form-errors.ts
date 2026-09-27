import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { isApiError } from '../../lib/api/errors';
import { applyFieldErrors } from '../auth/messages';

/**
 * Lleva un error de guardado al lugar donde se entiende (06 §8: errores junto al campo):
 *
 * - nombre repetido (`CATALOG_NAME_TAKEN`) → junto al campo del nombre;
 * - `VALIDATION_FAILED` con errores por campo → cada uno en su campo;
 * - lo demás (`VERSION_CONFLICT`, sin conexión…) → mensaje general del formulario.
 *
 * @returns el mensaje general, o `null` si todo quedó en los campos.
 */
export function saveErrorMessage<T extends FieldValues>(
  error: unknown,
  options: {
    readonly fields: readonly Path<T>[];
    readonly nameField?: Path<T>;
    readonly setError: UseFormSetError<T>;
  },
): string | null {
  if (!isApiError(error)) return 'Ocurrió un error inesperado.';
  if (error.code === 'CATALOG_NAME_TAKEN' && options.nameField !== undefined) {
    options.setError(options.nameField, { type: 'server', message: error.detail });
    return null;
  }
  if (applyFieldErrors(error, options.fields, options.setError)) return null;
  return error.detail;
}

/** ¿Otra persona cambió el registro mientras se editaba? La pantalla ofrece recargar. */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.code === 'VERSION_CONFLICT';
}
