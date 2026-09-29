import { uuidv7 } from '@hato/shared';
import { useState } from 'react';

/**
 * Clave de reintento de una escritura (ADR-012): el `id` del cliente en una creación o el
 * encabezado `Idempotency-Key` en una acción.
 *
 * La misma clave se repite en cada intento hasta que la escritura sale bien. Así, un doble clic o
 * un reintento después de perder la señal —cuando no se sabe si la API alcanzó a guardar— no
 * duplica el registro ni repite la acción. Después de un éxito se descarta y la siguiente
 * escritura lleva una nueva.
 */
export type RetryKey = {
  /** La clave del intento en curso (la crea la primera vez). */
  readonly current: () => string;
  /** Descarta la clave: la próxima escritura es otra. */
  readonly reset: () => void;
};

/** Clave de reintento fuera de React (y la que guarda `useRetryKey`). */
export function createRetryKey(): RetryKey {
  let key: string | null = null;
  return {
    current: () => (key ??= uuidv7()),
    reset: () => {
      key = null;
    },
  };
}

/** La clave de reintento de un formulario o una acción; estable entre renderizados. */
export function useRetryKey(): RetryKey {
  const [handle] = useState(createRetryKey);
  return handle;
}
