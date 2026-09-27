import { createFileRoute } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';
import { RequireRole } from '../../components/layout/RequireRole';

export const Route = createFileRoute('/_app/finance')({
  component: FinancePage,
});

function FinancePage() {
  return (
    <RequireRole roles={['ADMIN']} title="Finanzas">
      <PageHeader title="Finanzas" />
      <Placeholder icon={Wallet}>
        Aquí vas a registrar gastos y ventas, y a ver cuánto hay invertido en cada animal.
      </Placeholder>
    </RequireRole>
  );
}
