import { createFileRoute } from '@tanstack/react-router';
import { House } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { useRequiredSession } from '../../lib/auth/context';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

/** Inicio (06 §5.1). Las «preguntas del día» llegan con el tablero (M8). */
function HomePage() {
  const session = useRequiredSession();
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  return (
    <>
      <PageHeader title={session.farm.name} documentTitle="Inicio">
        Hola, {firstName}.
      </PageHeader>
      <EmptyState
        icon={House}
        title="Las preguntas del día"
        description="Aquí vas a ver las preguntas del día: cuántos animales hay, cuáles paren pronto, qué falta vacunar y cuántos nacieron este año."
      />
    </>
  );
}
