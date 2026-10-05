import type {
  AnimalFinance,
  CreateExpenseInput,
  CreateValuationInput,
  ExpenseDetail,
  ExpenseList,
  ExpensePreview,
  ExpenseType,
  FinanceSummary,
  SaleList,
  SaleView,
  UpdateExpenseInput,
  UpdateSaleInput,
  ValuationView,
  VoidEventInput,
} from '@hato/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useRetryKey } from '../../lib/api/retry-key';
import { useAuth } from '../../lib/auth/context';
import { saveFile } from '../../lib/files/save-file';
import { animalKeys } from '../animals/api';

/**
 * Datos de las finanzas (ECO-01 a ECO-06), solo ADMIN (RN-20): la web ni siquiera los pide para
 * otro rol, y la API los niega igual. Toda escritura lleva su clave de reintento (ADR-012): el gasto
 * y el avalúo, su `id` del cliente; las anulaciones, `Idempotency-Key`; las correcciones, `version`.
 * Al terminar se refresca lo que muestra montos: la pestaña Costos, los listados y el reporte.
 */

export const financeKeys = {
  all: ['finance'] as const,
  expenses: (filters: ExpenseFilters) => ['finance', 'expenses', filters] as const,
  expense: (id: string) => ['finance', 'expense', id] as const,
  sales: (from: string, to: string) => ['finance', 'sales', from, to] as const,
  animal: (animalId: string) => ['finance', 'animal', animalId] as const,
  summary: (from: string, to: string) => ['finance', 'summary', from, to] as const,
};

export type ExpenseFilters = {
  readonly type?: ExpenseType | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly voided?: boolean | undefined;
};

/** Todo lo económico y la auditoría de los animales tocados (la pestaña Cambios). */
function refreshFinance(queryClient: QueryClient, animalIds: readonly string[] = []) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: financeKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['animals', 'audit'] }),
    ...animalIds.map((id) => queryClient.invalidateQueries({ queryKey: animalKeys.detail(id) })),
  ]);
}

function queryOf(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  return search.toString();
}

export function useExpenses(filters: ExpenseFilters) {
  const { api } = useAuth();
  return useQuery({
    queryKey: financeKeys.expenses(filters),
    queryFn: () =>
      api.get<ExpenseList>(
        `/expenses?${queryOf({
          type: filters.type,
          from: filters.from,
          to: filters.to,
          voided: filters.voided === true ? 'true' : undefined,
          limit: '200',
        })}`,
      ),
  });
}

export function useExpense(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: financeKeys.expense(id),
    queryFn: () => api.get<ExpenseDetail>(`/expenses/${id}`),
  });
}

export function useSales(from: string, to: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: financeKeys.sales(from, to),
    queryFn: () => api.get<SaleList>(`/sales?${queryOf({ from, to, limit: '200' })}`),
  });
}

export function useAnimalFinance(animalId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: financeKeys.animal(animalId),
    queryFn: () => api.get<AnimalFinance>(`/animals/${animalId}/finance`),
  });
}

export function useFinanceSummary(from: string, to: string, enabled = true) {
  const { api } = useAuth();
  return useQuery({
    queryKey: financeKeys.summary(from, to),
    queryFn: () => api.get<FinanceSummary>(`/finance/summary?${queryOf({ from, to })}`),
    enabled,
  });
}

/** Reporte económico en Excel (ECO-06), con las mismas fechas que se ven. */
export function useExportFinanceSummary() {
  const { api } = useAuth();
  return useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      saveFile(await api.download(`/finance/summary/export.xlsx?${queryOf({ from, to })}`));
    },
  });
}

/**
 * Registrar un gasto (ECO-01, ECO-02). `preview` pide el reparto sin guardar; `create` guarda con
 * el `id` del cliente, que se conserva hasta que sale bien: un doble clic no registra dos gastos.
 */
export function useCreateExpense() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return {
    preview: useMutation({
      mutationFn: (body: CreateExpenseInput) =>
        api.post<ExpensePreview>('/expenses', { ...body, dryRun: true }),
    }),
    create: useMutation({
      mutationFn: (body: CreateExpenseInput) =>
        api.post<ExpenseDetail>('/expenses', {
          ...body,
          dryRun: undefined,
          id: clientId.current(),
        }),
      onSuccess: (saved) => {
        clientId.reset();
        return refreshFinance(
          queryClient,
          saved.allocations.map((allocation) => allocation.animal.id),
        );
      },
    }),
  };
}

export function useUpdateExpense(id: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateExpenseInput) => api.patch<ExpenseDetail>(`/expenses/${id}`, body),
    onSuccess: () => refreshFinance(queryClient),
  });
}

export function useVoidExpense(id: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const key = useRetryKey();
  return useMutation({
    mutationFn: (body: VoidEventInput) =>
      api.post<ExpenseDetail>(`/expenses/${id}/void`, body, { idempotencyKey: key.current() }),
    onSuccess: () => {
      key.reset();
      return refreshFinance(queryClient);
    },
  });
}

export function useUpdateSale() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSaleInput }) =>
      api.patch<SaleView>(`/sales/${id}`, body),
    onSuccess: (sale) => refreshFinance(queryClient, [sale.animal.id]),
  });
}

export function useCreateValuation() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useRetryKey();
  return useMutation({
    mutationFn: (body: CreateValuationInput) =>
      api.post<ValuationView>('/valuations', { ...body, id: clientId.current() }),
    onSuccess: (saved) => {
      clientId.reset();
      return refreshFinance(queryClient, [saved.animalId]);
    },
  });
}

export function useVoidValuation() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const key = useRetryKey();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VoidEventInput }) =>
      api.post<ValuationView>(`/valuations/${id}/void`, body, { idempotencyKey: key.current() }),
    onSuccess: (saved) => {
      key.reset();
      return refreshFinance(queryClient, [saved.animalId]);
    },
  });
}
