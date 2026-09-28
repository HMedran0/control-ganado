import type {
  AddIdentifierInput,
  AnimalDetail,
  AnimalDetailWithWarnings,
  AnimalList,
  ArchiveAnimalInput,
  AuditPage,
  BulkLotInput,
  BulkLotResult,
  BulkTagsInput,
  BulkTagsResult,
  CreateAnimalInput,
  ExitAnimalInput,
  Genealogy,
  IdentifierView,
  NextCodeResult,
  ReplaceIdentifierInput,
  ReplaceIdentifierResult,
  RestoreAnimalInput,
  RetireIdentifierInput,
  RevertExitInput,
  SearchResult,
  Timeline,
  UpdateAnimalInput,
  Warning,
} from '@hato/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../../lib/auth/context';

/**
 * Datos de animales (M4a) con TanStack Query.
 *
 * Qué se refresca tras cada escritura:
 * - **crear**: la ficha nueva entra a la caché con la respuesta; se invalidan listados,
 *   búsqueda, código sugerido y genealogías (la madre y el padre ganan una cría);
 * - **editar**: la ficha se reemplaza con la respuesta; se invalidan listados, búsqueda, su
 *   historial y genealogías (pudo cambiar de madre o de padre);
 * - **operaciones en lote**: listados, y ficha e historial de cada animal tocado;
 * - **identificadores**: ficha e historial del animal, y búsqueda;
 * - **salida, reversión, archivo y restauración** (M4c): la ficha se reemplaza con la respuesta;
 *   se invalidan listados, búsqueda, historial, código sugerido, cambios y las demás fichas,
 *   porque la de otro animal con el mismo número muestra a este en su `codeHistory`.
 */

const PAGE_SIZE = 50;

export const animalKeys = {
  all: ['animals'] as const,
  lists: ['animals', 'list'] as const,
  list: (query: string) => ['animals', 'list', query] as const,
  detail: (id: string) => ['animals', 'detail', id] as const,
  timeline: (id: string) => ['animals', 'timeline', id] as const,
  genealogies: ['animals', 'genealogy'] as const,
  genealogy: (id: string) => ['animals', 'genealogy', id] as const,
  searches: ['animals', 'search'] as const,
  search: (q: string) => ['animals', 'search', q] as const,
  nextCodes: ['animals', 'next-code'] as const,
  nextCode: (birthDate: string) => ['animals', 'next-code', birthDate] as const,
  audits: ['animals', 'audit'] as const,
  audit: (id: string) => ['animals', 'audit', id] as const,
};

/** Listado con «Cargar más» (paginación por cursor, ANI-06 CA3). */
export function useAnimalList(query: string) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: animalKeys.list(query),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<AnimalList>(
        `/animals?${query}&limit=${PAGE_SIZE}${pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAnimal(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: animalKeys.detail(id),
    queryFn: () => api.get<AnimalDetail>(`/animals/${id}`),
  });
}

export function useTimeline(id: string) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: animalKeys.timeline(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<Timeline>(
        `/animals/${id}/timeline?limit=20${pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useGenealogy(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: animalKeys.genealogy(id),
    queryFn: () => api.get<Genealogy>(`/animals/${id}/genealogy`),
  });
}

/** Código sugerido para una cría nacida en esa fecha (RN-28). */
export function useNextCode(birthDate: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: animalKeys.nextCode(birthDate ?? ''),
    queryFn: () =>
      api.get<NextCodeResult>(
        `/animals/next-code${birthDate === null ? '' : `?birthDate=${birthDate}`}`,
      ),
    enabled: birthDate !== null,
    staleTime: 0,
  });
}

/** Búsqueda global (ANI-05). La usan la barra de búsqueda, el lector y los resultados. */
export function fetchSearch(
  api: ReturnType<typeof useAuth>['api'],
  queryClient: QueryClient,
  q: string,
): Promise<SearchResult> {
  return queryClient.fetchQuery({
    queryKey: animalKeys.search(q),
    queryFn: () => api.get<SearchResult>(`/animals/search?q=${encodeURIComponent(q)}`),
    staleTime: 10_000,
  });
}

export function useSearch(q: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: animalKeys.search(q),
    queryFn: () => api.get<SearchResult>(`/animals/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim() !== '',
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------------------------

function refreshAnimals(queryClient: QueryClient, ids: readonly string[]): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: animalKeys.lists }),
    queryClient.invalidateQueries({ queryKey: animalKeys.searches }),
    ...ids.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: animalKeys.detail(id) }),
      queryClient.invalidateQueries({ queryKey: animalKeys.timeline(id) }),
    ]),
  ]);
}

/** Separa las advertencias de la ficha que responden `POST` y `PATCH`. */
function withoutWarnings(saved: AnimalDetailWithWarnings): {
  detail: AnimalDetail;
  warnings: readonly Warning[];
} {
  const { warnings, ...detail } = saved;
  return { detail, warnings };
}

export function useCreateAnimal() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAnimalInput) => api.post<AnimalDetailWithWarnings>('/animals', body),
    onSuccess: async (saved) => {
      const { detail } = withoutWarnings(saved);
      queryClient.setQueryData(animalKeys.detail(detail.id), detail);
      await Promise.all([
        refreshAnimals(queryClient, []),
        queryClient.invalidateQueries({ queryKey: animalKeys.nextCodes }),
        queryClient.invalidateQueries({ queryKey: animalKeys.genealogies }),
      ]);
    },
  });
}

export function useUpdateAnimal(id: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAnimalInput) =>
      api.patch<AnimalDetailWithWarnings>(`/animals/${id}`, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(animalKeys.detail(id), withoutWarnings(saved).detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: animalKeys.lists }),
        queryClient.invalidateQueries({ queryKey: animalKeys.searches }),
        queryClient.invalidateQueries({ queryKey: animalKeys.timeline(id) }),
        queryClient.invalidateQueries({ queryKey: animalKeys.genealogies }),
      ]);
    },
  });
}

export function useBulkTags() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkTagsInput) => api.post<BulkTagsResult>('/animals/bulk/tags', body),
    onSuccess: (_result, body) => refreshAnimals(queryClient, body.animalIds),
  });
}

export function useBulkLot() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkLotInput) => api.post<BulkLotResult>('/animals/bulk/lot', body),
    onSuccess: (_result, body) => refreshAnimals(queryClient, body.animalIds),
  });
}

export function useIdentifierMutations(animalId: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => refreshAnimals(queryClient, [animalId]);

  const add = useMutation({
    mutationFn: (body: AddIdentifierInput) =>
      api.post<IdentifierView & { warnings: readonly Warning[] }>(
        `/animals/${animalId}/identifiers`,
        body,
      ),
    onSuccess: refresh,
  });
  const replace = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReplaceIdentifierInput }) =>
      api.post<ReplaceIdentifierResult>(`/identifiers/${id}/replace`, body),
    onSuccess: refresh,
  });
  const retire = useMutation({
    mutationFn: ({ id, body }: { id: string; body: RetireIdentifierInput }) =>
      api.post<IdentifierView>(`/identifiers/${id}/retire`, body),
    onSuccess: refresh,
  });
  return { add, replace, retire };
}

/** Cambios del animal y sus identificadores (AUD-01 CA2), solo ADMIN. */
export function useAnimalAudit(id: string) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: animalKeys.audit(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<AuditPage>(
        `/audit?animalId=${id}&limit=20${pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Salida, reversión, archivo y restauración (ANI-03, ANI-04), solo ADMIN. */
export function useAnimalLifecycle(id: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const onSuccess = async (saved: AnimalDetailWithWarnings) => {
    queryClient.setQueryData(animalKeys.detail(id), withoutWarnings(saved).detail);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: animalKeys.lists }),
      queryClient.invalidateQueries({ queryKey: animalKeys.searches }),
      queryClient.invalidateQueries({ queryKey: animalKeys.timeline(id) }),
      queryClient.invalidateQueries({ queryKey: animalKeys.nextCodes }),
      queryClient.invalidateQueries({ queryKey: animalKeys.audits }),
      queryClient.invalidateQueries({
        queryKey: ['animals', 'detail'],
        predicate: (query) => query.queryKey[2] !== id,
      }),
    ]);
  };
  const post = (action: string) => (body: object) =>
    api.post<AnimalDetailWithWarnings>(`/animals/${id}/${action}`, body);
  return {
    exit: useMutation({
      mutationFn: (body: ExitAnimalInput) => post('exit')(body),
      onSuccess,
    }),
    revertExit: useMutation({
      mutationFn: (body: RevertExitInput) => post('revert-exit')(body),
      onSuccess,
    }),
    archive: useMutation({
      mutationFn: (body: ArchiveAnimalInput) => post('archive')(body),
      onSuccess,
    }),
    restore: useMutation({
      mutationFn: (body: RestoreAnimalInput) => post('restore')(body),
      onSuccess,
    }),
  };
}
