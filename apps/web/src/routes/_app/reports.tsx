import { createFileRoute } from '@tanstack/react-router';
import { ChartColumn } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

export const Route = createFileRoute('/_app/reports')({
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <>
      <PageHeader title="Reportes" />
      <EmptyState
        icon={ChartColumn}
        title="Los reportes llegan pronto"
        description="Aquí vas a consultar el inventario, los nacimientos y el reporte de grupos de edad del ICA, y a descargarlos en Excel."
      />
    </>
  );
}
