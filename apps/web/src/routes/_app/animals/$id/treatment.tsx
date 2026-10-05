import { createFileRoute } from '@tanstack/react-router';

import { AnimalEventPage } from '../../../../features/health/event-page';
import { TreatmentForm } from '../../../../features/health/TreatmentForm';

/** Registrar tratamiento (SAN-05). */
export const Route = createFileRoute('/_app/animals/$id/treatment')({
  component: function TreatmentRoute() {
    const { id } = Route.useParams();
    return (
      <AnimalEventPage id={id} title={(name) => `Registrar tratamiento · ${name}`}>
        {(animal) => <TreatmentForm animal={animal} />}
      </AnimalEventPage>
    );
  },
});
