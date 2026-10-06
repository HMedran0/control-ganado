import type { DashboardResponse } from '@hato/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type { ApiClient } from '../../lib/api/client';
import { useAuth } from '../../lib/auth/context';

/**
 * Tablero de Inicio (M8a). La misma consulta la arranca la guarda de `_app`, que vive en el
 * paquete principal, mientras se descarga el componente diferido: así la respuesta y el código
 * llegan en paralelo en una red lenta.
 */
export function dashboardQuery(api: ApiClient) {
  return queryOptions({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/dashboard'),
  });
}

export function useDashboard() {
  const { api } = useAuth();
  return useQuery(dashboardQuery(api));
}
