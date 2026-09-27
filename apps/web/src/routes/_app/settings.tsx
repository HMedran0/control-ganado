import { createFileRoute } from '@tanstack/react-router';
import { Settings } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { RequireRole } from '../../components/layout/RequireRole';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <RequireRole roles={['ADMIN']} title="Configuración">
      <PageHeader title="Configuración" />
      <EmptyState
        icon={Settings}
        title="La configuración llega pronto"
        description="Aquí vas a configurar la finca: razas, vacunas, lotes, etiquetas y usuarios."
      />
    </RequireRole>
  );
}
