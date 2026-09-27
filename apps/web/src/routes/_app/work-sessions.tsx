import { createFileRoute } from '@tanstack/react-router';
import { ClipboardList } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

export const Route = createFileRoute('/_app/work-sessions')({
  component: WorkSessionsPage,
});

function WorkSessionsPage() {
  return (
    <>
      <PageHeader title="Jornadas" />
      <EmptyState
        icon={ClipboardList}
        title="Todavía no hay jornadas"
        description="Aquí vas a organizar las jornadas de manga: vacunar, pesar o palpar un lote animal por animal."
      />
    </>
  );
}
