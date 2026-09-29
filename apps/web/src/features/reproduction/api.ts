import type {
  AbortionInput,
  BirthsReport,
  CalvingInput,
  CalvingResult,
  CreatePregnancyInput,
  DiagnosisInput,
  NextCodeResult,
  PregnancyView,
  PregnancyWithWarnings,
  UpdatePregnancyInput,
  VoidPregnancyInput,
} from '@hato/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useRetryKey } from '../../lib/api/retry-key';
import { useAuth } from '../../lib/auth/context';
import { animalKeys } from '../animals/api';

/**
 * Datos del control reproductivo (REP-01 a REP-05, NAC-01).
 *
 * Toda escritura lleva su clave de reintento (ADR-012): el servicio, su `id` del cliente; la
 * palpación, el aborto, la anulación y el parto, `Idempotency-Key`. Un doble clic o un reintento
 * después de perder la señal no registra dos veces. Al terminar se refrescan la ficha de la madre,
 * sus crías, los listados y la búsqueda, porque cambian las etiquetas y las alertas.
 */

export const reproductionKeys = {
  births: (from: string, to: string) => ['reports', 'births', from, to] as const,
  nextCodes: (birthDate: string, count: number) =>
    ['animals', 'next-code', birthDate, count] as const,
};

function refreshAfter(queryClient: QueryClient, animalIds: readonly string[]): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: animalKeys.lists }),
    queryClient.invalidateQueries({ queryKey: animalKeys.searches }),
    queryClient.invalidateQueries({ queryKey: animalKeys.genealogies }),
    queryClient.invalidateQueries({ queryKey: animalKeys.nextCodes }),
    queryClient.invalidateQueries({ queryKey: ['reports', 'births'] }),
    ...animalIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: animalKeys.detail(id) }),
      queryClient.invalidateQueries({ queryKey: animalKeys.timeline(id) }),
      queryClient.invalidateQueries({ queryKey: animalKeys.audit(id) }),
    ]),
  ]);
}

/** Servicio o preñez confirmada sin servicio conocido (REP-01, REP-02 CA3). */
export function useCreatePregnancy() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return useMutation({
    mutationFn: (body: CreatePregnancyInput) =>
      api.post<PregnancyWithWarnings>('/pregnancies', { ...body, id: clientId.current() }),
    onSuccess: (saved) => {
      clientId.reset();
      return refreshAfter(queryClient, [saved.dam.id]);
    },
  });
}

/** Acciones sobre una preñez abierta: palpación, aborto y, para el ADMIN, anulación. */
export function usePregnancyActions(damId: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const keys = { diagnosis: useRetryKey(), abortion: useRetryKey(), void: useRetryKey() };
  const action = <Body extends object, Result>(name: keyof typeof keys) => ({
    mutationFn: ({ id, body }: { id: string; body: Body }) =>
      api.post<Result>(`/pregnancies/${id}/${name}`, body, {
        idempotencyKey: keys[name].current(),
      }),
    onSuccess: () => {
      keys[name].reset();
      return refreshAfter(queryClient, [damId]);
    },
  });
  return {
    diagnose: useMutation(action<DiagnosisInput, PregnancyWithWarnings>('diagnosis')),
    abort: useMutation(action<AbortionInput, PregnancyWithWarnings>('abortion')),
    void: useMutation(action<VoidPregnancyInput, PregnancyView>('void')),
  };
}

/** Corrección de una preñez con `version` (PATCH). */
export function useUpdatePregnancy(damId: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePregnancyInput }) =>
      api.patch<PregnancyWithWarnings>(`/pregnancies/${id}`, body),
    onSuccess: () => refreshAfter(queryClient, [damId]),
  });
}

/** Parto (REP-04): cierra la preñez y crea las crías en una transacción. */
export function useCalving() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const retryKey = useRetryKey();
  return useMutation({
    mutationFn: (body: CalvingInput) =>
      api.post<CalvingResult>('/calvings', body, { idempotencyKey: retryKey.current() }),
    onSuccess: (result) => {
      retryKey.reset();
      return refreshAfter(queryClient, [
        result.pregnancy.dam.id,
        ...result.calves.map((calf) => calf.id),
      ]);
    },
  });
}

/** Códigos sugeridos para las crías de un parto, distintos entre sí (REP-04 CA3, ANI-10). */
export function useNextCodes(birthDate: string, count: number) {
  const { api } = useAuth();
  return useQuery({
    queryKey: reproductionKeys.nextCodes(birthDate, count),
    queryFn: () =>
      api.get<NextCodeResult>(`/animals/next-code?birthDate=${birthDate}&count=${count}`),
    enabled: count > 0,
    staleTime: 0,
  });
}

/** Reporte de nacimientos por período (NAC-01). */
export function useBirthsReport(from: string, to: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: reproductionKeys.births(from, to),
    queryFn: () => api.get<BirthsReport>(`/reports/births?from=${from}&to=${to}`),
  });
}
