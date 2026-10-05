import { createFileRoute } from '@tanstack/react-router';

import { RequireRole } from '../../../../../components/layout/RequireRole';
import { ExpenseDetailPage } from '../../../../../features/finance/ExpenseDetailPage';

/** Un gasto con su reparto (ECO-01, ECO-02), solo ADMIN. */
export const Route = createFileRoute('/_app/finance/expenses/$id/')({
  component: function ExpenseRoute() {
    const { id } = Route.useParams();
    return (
      <RequireRole roles={['ADMIN']} title="Gasto">
        <ExpenseDetailPage key={id} id={id} />
      </RequireRole>
    );
  },
});
