import { createFileRoute } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';

export const Route = createFileRoute('/_app/work-sessions')({
  component: WorkSessionsPage,
});

function WorkSessionsPage() {
  return (
    <>
      <PageHeader title="Jornadas" />
      <Placeholder icon={ClipboardList}>
        Aquí vas a organizar las jornadas de manga: vacunar, pesar o palpar un lote animal por
        animal.
      </Placeholder>
    </>
  );
}
