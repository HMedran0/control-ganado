import { createFileRoute } from '@tanstack/react-router';
import { ChartColumn } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';

export const Route = createFileRoute('/_app/reports')({
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <>
      <PageHeader title="Reportes" />
      <Placeholder icon={ChartColumn}>
        Aquí vas a consultar el inventario, los nacimientos y el reporte de grupos de edad del ICA,
        y a descargarlos en Excel.
      </Placeholder>
    </>
  );
}
