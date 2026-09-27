import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

export const Route = createFileRoute('/_app/record')({
  component: RecordPage,
});

function RecordPage() {
  return (
    <>
      <PageHeader title="Registrar" />
      <EmptyState
        icon={Plus}
        title="Aquí se registra el trabajo del día"
        description="Desde aquí vas a registrar partos, servicios, palpaciones, vacunas, pesajes y tratamientos con pocos toques."
      />
    </>
  );
}
