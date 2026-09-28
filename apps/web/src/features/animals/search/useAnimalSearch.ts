import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import type { SearchSource } from '../../../components/ui/SearchBar';
import { useAuth } from '../../../lib/auth/context';
import { fetchSearch } from '../api';
import { searchOutcome } from './outcome';

/**
 * Búsqueda de un animal desde cualquier lugar: la barra de búsqueda, el lector RFID o un enlace
 * (06 §2.1, «buscar primero»).
 *
 * Con una coincidencia exacta abre la ficha directamente (ANI-05 CA1, CA3); si coincidió por un
 * identificador retirado, la ficha lo avisa. Si no, va a la pantalla de resultados, que también
 * ofrece asociar un chip desconocido. Sin conexión, los resultados muestran el error.
 */
export function useAnimalSearch(): (q: string, source?: SearchSource) => Promise<void> {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(
    async (q: string) => {
      const query = q.trim();
      if (query === '') return;
      try {
        const outcome = searchOutcome(await fetchSearch(api, queryClient, query));
        if (outcome.kind === 'open') {
          await navigate({
            to: '/animals/$id',
            params: { id: outcome.animalId },
            search: outcome.previous === null ? {} : { anterior: outcome.previous.value },
          });
          return;
        }
      } catch {
        // La pantalla de resultados vuelve a consultar y muestra el error con su mensaje.
      }
      await navigate({ to: '/search', search: { q: query } });
    },
    [api, queryClient, navigate],
  );
}
