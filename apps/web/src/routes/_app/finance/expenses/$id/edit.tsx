import { createFileRoute } from '@tanstack/react-router';

import { PageHeader } from '../../../../../components/layout/PageHeader';
import { RequireRole } from '../../../../../components/layout/RequireRole';
import { FormError } from '../../../../../components/ui/FormError';
import { useExpense } from '../../../../../features/finance/api';
import { ExpenseForm } from '../../../../../features/finance/ExpenseForm';

/** Corregir un gasto (ADR-016), solo ADMIN. */
export const Route = createFileRoute('/_app/finance/expenses/$id/edit')({
  component: function EditExpenseRoute() {
    const { id } = Route.useParams();
    return (
      <RequireRole roles={['ADMIN']} title="Corregir gasto">
        <PageHeader title="Corregir gasto" />
        <EditExpense id={id} />
      </RequireRole>
    );
  },
});

function EditExpense({ id }: { id: string }) {
  const expense = useExpense(id);
  if (expense.isPending) return <p className="text-texto-2">Cargando gasto…</p>;
  if (expense.isError) return <FormError message="No pudimos cargar el gasto." />;
  return <ExpenseForm key={expense.data.version} expense={expense.data} />;
}
