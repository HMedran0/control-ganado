import { createFileRoute } from '@tanstack/react-router';
import { Bell } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

export const Route = createFileRoute('/_app/alerts')({
  component: AlertsPage,
});

function AlertsPage() {
  return (
    <>
      <PageHeader title="Alertas" />
      <EmptyState
        icon={Bell}
        title="Sin alertas por ahora"
        description="Aquí vas a ver las vacunas vencidas, los partos próximos, las servidas sin diagnóstico y los animales en retiro."
      />
    </>
  );
}
