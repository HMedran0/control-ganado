import {
  ALLOCATION_METHOD_LABEL,
  EXPENSE_TYPE_LABEL,
  formatCop,
  formatDate,
  type ExpenseDetail,
} from '@hato/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { AlertBanner } from '../../components/ui/AlertBanner';
import { Button } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormError } from '../../components/ui/FormError';
import { isApiError } from '../../lib/api/errors';
import { VoidEventDialog } from '../health/VoidEventDialog';
import { useExpense, useVoidExpense } from './api';
import './nav-state';

const LINK = 'font-bold text-potrero underline underline-offset-4';

/** A quién se cargó: «Lote Paridas · partes iguales · 38 animales». */
export function targetText(expense: ExpenseDetail | Omit<ExpenseDetail, 'allocations'>): string {
  if (expense.method === 'GENERAL') return 'Gasto general de la finca';
  if (expense.method === 'DIRECT')
    return expense.animal === null ? 'Un animal' : `Animal ${expense.animal.code}`;
  const who = expense.lot === null ? 'Animales elegidos' : `Lote ${expense.lot.name}`;
  const count = expense.animalCount === 1 ? '1 animal' : `${expense.animalCount} animales`;
  return `${who} · ${ALLOCATION_METHOD_LABEL[expense.method].toLowerCase()} · ${count}`;
}

/**
 * Un gasto (ECO-01, ECO-02), solo ADMIN: qué fue, a quién se cargó y la parte de cada animal, en
 * el orden del reparto (el primero lleva el residuo, ADR-016). Desde aquí se corrige o se anula;
 * las dos cosas quedan en los cambios de cada animal.
 */
export function ExpenseDetailPage({ id }: { id: string }) {
  const expense = useExpense(id);
  const voidExpense = useVoidExpense(id);
  const [voiding, setVoiding] = useState(false);
  const saved = useRouterState({ select: (state) => state.location.state.financeSaved });

  if (expense.isPending) return <p className="text-texto-2">Cargando gasto…</p>;
  if (expense.isError) {
    return isApiError(expense.error) && expense.error.status === 404 ? (
      <EmptyState
        icon={SearchX}
        title="No encontramos ese gasto"
        description="Puede que sea de otra finca o que el enlace esté incompleto."
      />
    ) : (
      <FormError message="No pudimos cargar el gasto." />
    );
  }
  const data = expense.data;

  return (
    <>
      <PageHeader title={data.description} />
      <div className="flex max-w-3xl flex-col gap-5">
        {saved === undefined ? null : <AlertBanner tone="info" title={saved} />}
        {data.voided ? (
          <AlertBanner
            tone="alerta"
            title="Gasto anulado"
            description={`No cuenta en la inversión de ningún animal. Motivo: ${data.voidReason ?? '—'}`}
          />
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['Monto', <strong key="monto">{formatCop(data.amount)}</strong>],
              ['Fecha', formatDate(data.date)],
              ['Tipo', EXPENSE_TYPE_LABEL[data.type]],
              ['A quién se cargó', targetText(data)],
              ['Registró', data.createdBy],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-texto-2">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {data.voided ? null : (
          <div className="flex flex-wrap gap-3">
            <Link
              to="/finance/expenses/$id/edit"
              params={{ id }}
              className="inline-flex min-h-touch items-center justify-center rounded-control border-2 border-potrero px-4 font-bold text-potrero hover:bg-potrero-claro"
            >
              Corregir
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setVoiding(true);
              }}
            >
              Anular
            </Button>
          </div>
        )}

        {data.allocations.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            <h2 className="text-md font-bold">Reparto</h2>
            <DataTable
              caption={`Reparto de ${data.description}`}
              rowKey={(row) => row.animal.id}
              rows={data.allocations}
              columns={[
                {
                  key: 'animal',
                  header: 'Animal',
                  mobile: 'primary',
                  cell: (row) => (
                    <Link
                      to="/animals/$id"
                      params={{ id: row.animal.id }}
                      search={{ tab: 'costos' }}
                      className={LINK}
                    >
                      {row.animal.code}
                      {row.animal.name === null ? '' : ` · ${row.animal.name}`}
                    </Link>
                  ),
                },
                {
                  key: 'amount',
                  header: 'Su parte',
                  align: 'end',
                  mobile: 'secondary',
                  cell: (row) => formatCop(row.amount),
                },
              ]}
            />
          </section>
        )}
      </div>
      {voiding ? (
        <VoidEventDialog
          title="Anular el gasto"
          description="Deja de contar en la inversión de cada animal. Queda en los cambios con su motivo."
          animalId=""
          error={voidExpense.error}
          pending={voidExpense.isPending}
          onVoid={(body) => voidExpense.mutateAsync(body)}
          onClose={() => {
            setVoiding(false);
          }}
        />
      ) : null}
    </>
  );
}
