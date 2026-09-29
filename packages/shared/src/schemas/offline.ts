/**
 * Piezas de las escrituras listas para trabajar sin conexión (ADR-012).
 *
 * - Toda creación acepta un `id` generado por el cliente (§1): un UUIDv7, para que la app sin
 *   conexión pueda enlazar registros antes de hablar con el servidor.
 * - Las acciones que no son creaciones aceptan el encabezado `Idempotency-Key` (§2).
 */

import { z } from 'zod';

import { isUuidv7 } from '../id.js';

/** `id` que genera el cliente al crear (ADR-012 §1): UUID versión 7 en minúsculas. */
export const clientIdSchema = z
  .string({ message: 'El identificador no es válido.' })
  .refine(isUuidv7, { message: 'El identificador debe ser un UUID versión 7.' });

/** Encabezado de reintento seguro de las acciones (ADR-012 §2). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Días que la API guarda la respuesta de una `Idempotency-Key` antes de purgarla. */
export const IDEMPOTENCY_KEY_TTL_DAYS = 7;
