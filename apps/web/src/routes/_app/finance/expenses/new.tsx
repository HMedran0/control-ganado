import { createFileRoute, useRouterState } from '@tanstack/react-router';

import { PageHeader } from '../../../../components/layout/PageHeader';
import { RequireRole } from '../../../../components/layout/RequireRole';
import { useAnimal } from '../../../../features/animals/api';
import { ExpenseForm } from '../../../../features/finance/ExpenseForm';
import '../../../../features/finance/nav-state';

type NewExpenseSearch = { animalId?: string; lotId?: string };

/**
 * Registrar un gasto (ECO-01, ECO-02), solo ADMIN. Llega desde Finanzas, desde Registrar, desde la
 * pestaña Costos de un animal (`?animalId=`) o desde la selección del listado (los animales viajan
 * en el estado de la navegación, no en la URL).
 */
export const Route = createFileRoute('/_app/finance/expenses/new')({
  validateSearch: (search: Record<string, unknown>): NewExpenseSearch => ({
    ...(typeof search.animalId === 'string' ? { animalId: search.animalId } : {}),
    ...(typeof search.lotId === 'string' ? { lotId: search.lotId } : {}),
  }),
  component: function NewExpenseRoute() {
    const search = Route.useSearch();
    const selection = useRouterState({
      select: (state) => state.location.state.expenseAnimalIds,
    });
    return (
      <RequireRole roles={['ADMIN']} title="Registrar gasto">
        <PageHeader title="Registrar gasto" />
        {search.animalId === undefined ? (
          <ExpenseForm initialLotId={search.lotId} selection={selection ?? []} />
        ) : (
          <WithAnimal animalId={search.animalId} />
        )}
      </RequireRole>
    );
  },
});

/** El gasto de un animal: el formulario llega con el animal ya elegido. */
function WithAnimal({ animalId }: { animalId: string }) {
  const animal = useAnimal(animalId);
  if (animal.isPending) return <p className="text-texto-2">Cargando…</p>;
  return (
    <ExpenseForm
      initialAnimal={
        animal.data === undefined
          ? null
          : { id: animal.data.id, code: animal.data.code, name: animal.data.name }
      }
    />
  );
}
