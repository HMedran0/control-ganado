import { QueryClient } from '@tanstack/react-query';

import { isApiError } from './api/errors';

/**
 * Caché de datos del servidor (04-arquitectura.md §6).
 *
 * Un error 4xx es una respuesta, no una falla pasajera: reintentarlo solo retrasa el mensaje.
 * Los de red sí se reintentan, porque en el campo la señal va y viene.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
