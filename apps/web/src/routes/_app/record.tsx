import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';

export const Route = createFileRoute('/_app/record')({
  component: RecordPage,
});

function RecordPage() {
  return (
    <>
      <PageHeader title="Registrar" />
      <Placeholder icon={Plus}>
        Desde aquí vas a registrar partos, servicios, palpaciones, vacunas, pesajes y tratamientos
        con pocos toques.
      </Placeholder>
    </>
  );
}
