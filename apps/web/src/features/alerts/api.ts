import type { AlertsResponse } from '@hato/shared';
import { useInfiniteQuery } from '@tanstack/react-query';

import { useAuth } from '../../lib/auth/context';

/** Página de Alertas (M6): conteos por tipo y animales, con los filtros de la URL. */
export function useAlerts(query: string) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: ['alerts', query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(query);
      params.set('limit', '50');
      if (pageParam !== null) params.set('cursor', pageParam);
      return api.get<AlertsResponse>(`/alerts?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
