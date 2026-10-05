import type {
  BulkVaccinationInput,
  BulkVaccinationResult,
  CreateTreatmentInput,
  CreateVaccinationInput,
  CycleProgressView,
  TreatmentList,
  TreatmentView,
  VaccinationList,
  VaccinationView,
  VaccinationWithWarnings,
  VoidEventInput,
} from '@hato/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useRetryKey } from '../../lib/api/retry-key';
import { useAuth } from '../../lib/auth/context';
import { animalKeys } from '../animals/api';

/**
 * Datos de la sanidad (SAN-02 a SAN-06). Toda escritura lleva su clave de reintento (ADR-012):
 * la vacunación y el tratamiento, su `id` del cliente; el lote y las anulaciones,
 * `Idempotency-Key`. Al terminar se refrescan la ficha, los listados y las alertas, porque
 * cambian las etiquetas («En retiro») y las alertas de vacunas.
 */

export const healthKeys = {
  vaccinations: (animalId: string) => ['vaccinations', animalId] as const,
  treatments: (animalId: string) => ['treatments', animalId] as const,
  cycleProgress: (cycleId: string) => ['vaccination-cycles', cycleId, 'progress'] as const,
};

export function refreshHealth(queryClient: QueryClient, animalIds: readonly string[]) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: animalKeys.lists }),
    queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    queryClient.invalidateQueries({ queryKey: ['vaccination-cycles'] }),
    ...animalIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: animalKeys.detail(id) }),
      queryClient.invalidateQueries({ queryKey: animalKeys.timeline(id) }),
      queryClient.invalidateQueries({ queryKey: healthKeys.vaccinations(id) }),
      queryClient.invalidateQueries({ queryKey: healthKeys.treatments(id) }),
    ]),
  ]);
}

export function useAnimalVaccinations(animalId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: healthKeys.vaccinations(animalId),
    queryFn: () => api.get<VaccinationList>(`/vaccinations?animalId=${animalId}&limit=200`),
  });
}

export function useAnimalTreatments(animalId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: healthKeys.treatments(animalId),
    queryFn: () => api.get<TreatmentList>(`/treatments?animalId=${animalId}&limit=200`),
  });
}

export function useCycleProgress(cycleId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: healthKeys.cycleProgress(cycleId),
    queryFn: () => api.get<CycleProgressView>(`/vaccination-cycles/${cycleId}/progress`),
  });
}

/** Vacunación individual (SAN-02). */
export function useCreateVaccination() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return useMutation({
    mutationFn: (body: CreateVaccinationInput) =>
      api.post<VaccinationWithWarnings>('/vaccinations', { ...body, id: clientId.current() }),
    onSuccess: (saved) => {
      clientId.reset();
      return refreshHealth(queryClient, [saved.animal.id]);
    },
  });
}

/** Tratamiento (SAN-05). */
export function useCreateTreatment() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return useMutation({
    mutationFn: (body: CreateTreatmentInput) =>
      api.post<TreatmentView>('/treatments', { ...body, id: clientId.current() }),
    onSuccess: (saved) => {
      clientId.reset();
      return refreshHealth(queryClient, [saved.animal.id]);
    },
  });
}

/**
 * Vacunación por lote (SAN-03): la simulación no guarda nada; la confirmación lleva una clave que
 * se conserva hasta que sale bien, así un doble clic o un reintento no vacuna dos veces.
 */
export function useBulkVaccination() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const key = useRetryKey();
  return {
    preview: useMutation({
      mutationFn: (body: BulkVaccinationInput) =>
        api.post<BulkVaccinationResult>('/vaccinations/bulk?dryRun=true', body),
    }),
    confirm: useMutation({
      mutationFn: (body: BulkVaccinationInput) =>
        api.post<BulkVaccinationResult>('/vaccinations/bulk', body, {
          idempotencyKey: key.current(),
        }),
      onSuccess: (result) => {
        key.reset();
        return refreshHealth(
          queryClient,
          result.toApply.map((animal) => animal.id),
        );
      },
    }),
  };
}

/** Anular una vacunación o un tratamiento (ADMIN y VET). */
export function useVoidHealthEvent(animalId: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const key = useRetryKey();
  return useMutation({
    mutationFn: ({
      kind,
      id,
      body,
    }: {
      kind: 'vaccinations' | 'treatments';
      id: string;
      body: VoidEventInput;
    }) =>
      api.post<VaccinationView | TreatmentView>(`/${kind}/${id}/void`, body, {
        idempotencyKey: key.current(),
      }),
    onSuccess: () => {
      key.reset();
      return refreshHealth(queryClient, [animalId]);
    },
  });
}
