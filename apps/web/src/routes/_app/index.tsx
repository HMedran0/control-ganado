import { createFileRoute } from '@tanstack/react-router';
import { House } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Placeholder } from '../../components/layout/Placeholder';
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
      <Placeholder icon={House}>
        Aquí vas a ver las preguntas del día: cuántos animales hay, cuáles paren pronto, qué falta
        vacunar y cuántos nacieron este año.
      </Placeholder>
    </>
  );
}
