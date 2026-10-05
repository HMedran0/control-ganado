import { createFileRoute } from '@tanstack/react-router';

import { PageHeader } from '../../../components/layout/PageHeader';
import { RequireRole } from '../../../components/layout/RequireRole';
import { FinancePage, type FinanceTab } from '../../../features/finance/FinancePage';

const TABS: readonly FinanceTab[] = ['gastos', 'ventas', 'reporte'];

/** Finanzas (ECO-01 a ECO-06), solo ADMIN (RN-20). La pestaña va en la URL (06 §4). */
export const Route = createFileRoute('/_app/finance/')({
  validateSearch: (search: Record<string, unknown>): { tab?: FinanceTab } =>
    typeof search.tab === 'string' && (TABS as readonly string[]).includes(search.tab)
      ? { tab: search.tab as FinanceTab }
      : {},
  component: function FinanceRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequireRole roles={['ADMIN']} title="Finanzas">
        <PageHeader title="Finanzas" />
        <FinancePage
          tab={search.tab ?? 'gastos'}
          onTabChange={(tab) => {
            void navigate({ search: { tab }, replace: true });
          }}
        />
      </RequireRole>
    );
  },
});
