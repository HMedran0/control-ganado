import type {
  BreedView,
  CatalogList,
  CycleView,
  DeactivationWarnings,
  FarmView,
  LotView,
  TagView,
  UpdateFarmInput,
  UserView,
  UserWithTemporaryPassword,
  VaccineView,
  Warning,
} from '@hato/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRetryKey } from '../../lib/api/retry-key';
import { useAuth } from '../../lib/auth/context';

/**
 * Datos de Configuración (M3): finca, catálogos y usuarios, con TanStack Query.
 *
 * Cada escritura invalida su listado, así que las pantallas se actualizan solas después de
 * guardar, desactivar o deshacer.
 */

/** Catálogos y la ruta de la API de cada uno. */
export const CATALOGS = {
  breeds: '/breeds',
  vaccines: '/vaccines',
  cycles: '/vaccination-cycles',
  lots: '/lots',
  tags: '/tags',
} as const;

export type CatalogKey = keyof typeof CATALOGS;

/** Tipo de cada elemento de catálogo, por clave. */
export type CatalogItem = {
  breeds: BreedView;
  vaccines: VaccineView;
  cycles: CycleView;
  lots: LotView;
  tags: TagView;
};

/** Respuesta de una escritura: el elemento y sus advertencias (si las hay). */
export type Saved<T> = T & { readonly warnings?: readonly Warning[] };

const catalogKey = (catalog: CatalogKey) => ['catalog', catalog] as const;

/** Listado de un catálogo. Con `includeInactive`, también los desactivados. */
export function useCatalog<K extends CatalogKey>(catalog: K, includeInactive = false) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...catalogKey(catalog), { includeInactive }],
    queryFn: () =>
      api.get<CatalogList<CatalogItem[K]>>(
        `${CATALOGS[catalog]}${includeInactive ? '?includeInactive=true' : ''}`,
      ),
  });
}

/** Un elemento del catálogo por id (desde el listado completo: los catálogos son pequeños). */
export function useCatalogItem<K extends CatalogKey>(catalog: K, id: string) {
  const query = useCatalog(catalog, true);
  return { ...query, item: query.data?.items.find((item) => item.id === id) };
}

/** Crear y editar elementos de un catálogo. */
export function useCatalogMutations<K extends CatalogKey>(catalog: K) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: catalogKey(catalog) });

  // `id` del cliente (ADR-012 §1): un doble clic en «Guardar» no crea dos elementos.
  const clientId = useRetryKey();
  const create = useMutation({
    mutationFn: (body: object) =>
      api.post<Saved<CatalogItem[K]>>(CATALOGS[catalog], { id: clientId.current(), ...body }),
    onSuccess: () => {
      clientId.reset();
      return invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { version: number } & Record<string, unknown>;
    }) => api.patch<Saved<CatalogItem[K]>>(`${CATALOGS[catalog]}/${id}`, body),
    onSuccess: invalidate,
  });
  return { create, update };
}

/** Lo que advertiría desactivar el elemento (lotes con animales, vacunas de ciclos abiertos). */
export function fetchDeactivationWarnings(
  api: ReturnType<typeof useAuth>['api'],
  catalog: 'lots' | 'vaccines',
  id: string,
): Promise<DeactivationWarnings> {
  return api.get<DeactivationWarnings>(`${CATALOGS[catalog]}/${id}/deactivation-warnings`);
}

// --- Finca -----------------------------------------------------------------------------------

export function useFarm() {
  const { api } = useAuth();
  return useQuery({ queryKey: ['farm'], queryFn: () => api.get<FarmView>('/farm') });
}

export function useUpdateFarm() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateFarmInput) => api.patch<FarmView>('/farm', body),
    onSuccess: (farm) => {
      queryClient.setQueryData(['farm'], farm);
      // El sistema productivo y los parámetros cambian lo que muestra Inicio (CFG-03).
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// --- Usuarios --------------------------------------------------------------------------------

export function useUsers() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: UserView[] }>('/users'),
  });
}

export function useUserMutations() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  return {
    create: useMutation({
      mutationFn: (body: unknown) => api.post<UserWithTemporaryPassword>('/users', body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
        api.patch<UserView>(`/users/${id}`, body),
      onSuccess: invalidate,
    }),
    resetPassword: useMutation({
      mutationFn: (id: string) =>
        api.post<UserWithTemporaryPassword>(`/users/${id}/reset-password`),
      onSuccess: invalidate,
    }),
  };
}
