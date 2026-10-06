import { createFileRoute } from '@tanstack/react-router';

import { PageHeader } from '../../components/layout/PageHeader';
import { AnimalSearchBar } from '../../features/animals/search/AnimalSearchBar';
import { HomeDashboard } from '../../features/dashboard/HomeDashboard';
import { useRequiredSession } from '../../lib/auth/context';

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});

/**
 * Inicio — «Preguntas del día» (06 §5.1, RPT-01; M8a). La consulta del tablero la arranca la
 * guarda de `_app`, antes de que baje este componente.
 */
function HomePage() {
  const session = useRequiredSession();
  const firstName = session.user.name.split(' ')[0] ?? session.user.name;

  return (
    <>
      <PageHeader title={session.farm.name} documentTitle="Inicio">
        Hola, {firstName}.
      </PageHeader>
      {/* En móvil la búsqueda va arriba de Inicio (06 §4); en escritorio está en la barra superior. */}
      <div className="mb-6 lg:hidden">
        <AnimalSearchBar />
      </div>
      <HomeDashboard />
    </>
  );
}
