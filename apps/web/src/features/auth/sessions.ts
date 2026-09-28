import {
  daysBetween,
  formatDate,
  isoDateFromInstant,
  type IsoDate,
  type SessionView,
} from '@hato/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../lib/auth/context';
import { FARM_TIME_ZONE } from '../../lib/clock';

/** Sesiones abiertas del usuario (AUT-11, 06 §5.9). */

const SESSIONS_KEY = ['auth', 'sessions'] as const;

export function useSessions() {
  const { api } = useAuth();
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => api.get<{ items: SessionView[] }>('/auth/sessions'),
  });
}

export function useSessionMutations() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  return {
    revoke: useMutation({
      mutationFn: (id: string) =>
        api.post<{ ok: true; current: boolean }>(`/auth/sessions/${id}/revoke`),
      onSuccess: invalidate,
    }),
    revokeOthers: useMutation({
      mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
      onSuccess: invalidate,
    }),
  };
}

/** Cierra todas las sesiones de un usuario de la finca (AUT-11 CA3, solo ADMIN). */
export function useRevokeUserSessions() {
  const { api } = useAuth();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<{ revoked: number }>(`/users/${userId}/sessions/revoke`),
  });
}

/** Día de la finca en que ocurrió un instante ISO de la API. */
function farmDay(instant: string): IsoDate {
  return isoDateFromInstant(new Date(instant), FARM_TIME_ZONE);
}

/** «Desde 02/09/2026». */
export function formatSessionStart(startedAt: string): string {
  return `Desde ${formatDate(farmDay(startedAt))}`;
}

/** «usada hoy», «usada ayer», «usada hace 3 días» o, pasada una semana, «usada el 14/08/2026». */
export function formatLastUse(lastUsedAt: string, today: IsoDate): string {
  const day = farmDay(lastUsedAt);
  const days = daysBetween(day, today);
  if (days <= 0) return 'usada hoy';
  if (days === 1) return 'usada ayer';
  if (days <= 7) return `usada hace ${days} días`;
  return `usada el ${formatDate(day)}`;
}
