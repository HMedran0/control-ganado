import type {
  AnimalWeights,
  CreateScaleProfileInput,
  CreateWeightInput,
  ScaleAssociation,
  ScaleColumnMapping,
  ScaleProfileList,
  ScaleProfileView,
  VoidEventInput,
  WeightImportDryRun,
  WeightImportResult,
  WeightView,
  WeightWithWarnings,
} from '@hato/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRetryKey } from '../../lib/api/retry-key';
import { useAuth } from '../../lib/auth/context';
import { animalKeys } from '../animals/api';
import { refreshHealth } from '../health/api';

/** Pesos y báscula (PES-01, PES-02, PES-04, PES-05). */

export const weightKeys = {
  animal: (animalId: string) => ['weights', animalId] as const,
  profiles: ['scale-profiles'] as const,
};

export function useAnimalWeights(animalId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: weightKeys.animal(animalId),
    queryFn: () => api.get<AnimalWeights>(`/animals/${animalId}/weights`),
  });
}

/** Pesaje digitado (PES-01). */
export function useCreateWeight() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return useMutation({
    mutationFn: (body: CreateWeightInput) =>
      api.post<WeightWithWarnings>('/weights', { ...body, id: clientId.current() }),
    onSuccess: async (saved) => {
      clientId.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: weightKeys.animal(saved.animalId) }),
        refreshHealth(queryClient, [saved.animalId]),
      ]);
    },
  });
}

export function useVoidWeight(animalId: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const key = useRetryKey();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VoidEventInput }) =>
      api.post<WeightView>(`/weights/${id}/void`, body, { idempotencyKey: key.current() }),
    onSuccess: async () => {
      key.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: weightKeys.animal(animalId) }),
        refreshHealth(queryClient, [animalId]),
      ]);
    },
  });
}

export function useScaleProfiles() {
  const { api } = useAuth();
  return useQuery({
    queryKey: weightKeys.profiles,
    queryFn: () => api.get<ScaleProfileList>('/scale-profiles'),
  });
}

/** Guardar el mapeo propuesto como perfil de la finca (ADMIN). */
export function useCreateScaleProfile() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return useMutation({
    mutationFn: (body: CreateScaleProfileInput) =>
      api.post<ScaleProfileView>('/scale-profiles', { ...body, id: clientId.current() }),
    onSuccess: () => {
      clientId.reset();
      return queryClient.invalidateQueries({ queryKey: weightKeys.profiles });
    },
  });
}

/** Lo que la persona eligió para la importación de la báscula. */
export type ScaleImportRequest = {
  readonly file: File;
  /** Perfil de la finca o plantilla del sistema; sin él, el mapeo propuesto o ajustado. */
  readonly scaleProfileId: string | null;
  readonly mapping: ScaleColumnMapping | null;
  readonly associations: readonly ScaleAssociation[];
  readonly skip: readonly string[];
};

function formOf(request: ScaleImportRequest, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  // Los campos van antes que el archivo: así la API los tiene al leer el archivo.
  if (request.scaleProfileId !== null) form.append('scaleProfileId', request.scaleProfileId);
  else if (request.mapping !== null) form.append('mapping', JSON.stringify(request.mapping));
  if (request.associations.length > 0) {
    form.append('associations', JSON.stringify(request.associations));
  }
  if (request.skip.length > 0) form.append('skip', request.skip.join(','));
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  form.append('file', request.file, request.file.name);
  return form;
}

/** Importar la sesión de la báscula (PES-04): simulación y confirmación una sola vez (ADR-011). */
export function useScaleImport() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return {
    preview: useMutation({
      mutationFn: (request: ScaleImportRequest) =>
        api.post<WeightImportDryRun>('/weights/import?dryRun=true', formOf(request)),
    }),
    confirm: useMutation({
      mutationFn: ({
        request,
        importKey,
        expectedRows,
      }: {
        request: ScaleImportRequest;
        importKey: string;
        expectedRows: number;
      }) =>
        api.post<WeightImportResult>(
          '/weights/import',
          formOf(request, { importKey, expectedRows: String(expectedRows) }),
        ),
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: animalKeys.all }),
          queryClient.invalidateQueries({ queryKey: ['weights'] }),
          queryClient.invalidateQueries({ queryKey: ['alerts'] }),
        ]),
    }),
  };
}
