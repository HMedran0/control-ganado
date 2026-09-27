import { createFileRoute } from '@tanstack/react-router';
import { Bell } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';

export const Route = createFileRoute('/_app/alerts')({
  component: AlertsPage,
});

function AlertsPage() {
  return (
    <>
      <PageHeader title="Alertas" />
      <Placeholder icon={Bell}>
        Aquí vas a ver las vacunas vencidas, los partos próximos, las servidas sin diagnóstico y los
        animales en retiro.
      </Placeholder>
    </>
  );
}
