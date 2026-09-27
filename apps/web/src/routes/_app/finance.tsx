import { createFileRoute } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { RequireRole } from '../../components/layout/RequireRole';

export const Route = createFileRoute('/_app/finance')({
  component: FinancePage,
});

function FinancePage() {
  return (
    <RequireRole roles={['ADMIN']} title="Finanzas">
      <PageHeader title="Finanzas" />
      <EmptyState
        icon={Wallet}
        title="Las finanzas llegan pronto"
        description="Aquí vas a registrar gastos y ventas, y a ver cuánto hay invertido en cada animal."
      />
    </RequireRole>
  );
}
