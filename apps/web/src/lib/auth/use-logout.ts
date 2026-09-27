import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useAuth } from './context';

/**
 * Cierre de sesión (AUT-02): revoca el refresco en la API, borra la sesión en memoria y los
 * datos en caché —el siguiente que use el equipo no debe ver nada del anterior— y lleva al
 * inicio de sesión.
 */
export function useLogout(): () => Promise<void> {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    await api.logout();
    queryClient.clear();
    await navigate({ to: '/login', replace: true });
  }, [api, queryClient, navigate]);
}
