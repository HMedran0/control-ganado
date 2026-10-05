import { createFileRoute } from '@tanstack/react-router';

import { AnimalEventPage } from '../../../../features/health/event-page';
import { VaccinationForm } from '../../../../features/health/VaccinationForm';

/** Registrar vacuna (SAN-02). `?vaccineId=` llega desde una alerta (SAN-04 CA3). */
export const Route = createFileRoute('/_app/animals/$id/vaccination')({
  validateSearch: (search: Record<string, unknown>): { vaccineId?: string } =>
    typeof search.vaccineId === 'string' ? { vaccineId: search.vaccineId } : {},
  component: function VaccinationRoute() {
    const { id } = Route.useParams();
    const { vaccineId } = Route.useSearch();
    return (
      <AnimalEventPage id={id} title={(name) => `Registrar vacuna · ${name}`}>
        {(animal) => <VaccinationForm animal={animal} vaccineId={vaccineId} />}
      </AnimalEventPage>
    );
  },
});
