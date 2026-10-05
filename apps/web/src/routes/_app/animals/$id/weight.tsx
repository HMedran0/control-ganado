import { createFileRoute } from '@tanstack/react-router';

import { AnimalEventPage } from '../../../../features/health/event-page';
import { WeightForm } from '../../../../features/weights/WeightForm';

/** Registrar peso (PES-01). */
export const Route = createFileRoute('/_app/animals/$id/weight')({
  component: function WeightRoute() {
    const { id } = Route.useParams();
    return (
      <AnimalEventPage id={id} title={(name) => `Registrar peso · ${name}`}>
        {(animal) => <WeightForm animal={animal} />}
      </AnimalEventPage>
    );
  },
});
