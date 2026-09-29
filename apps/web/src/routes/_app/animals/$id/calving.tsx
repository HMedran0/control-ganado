import { createFileRoute } from '@tanstack/react-router';

import { DamPage } from '../../../../features/reproduction/form-kit';
import { CalvingForm } from '../../../../features/reproduction/CalvingForm';

/** Registrar parto (REP-04, CU-01). */
export const Route = createFileRoute('/_app/animals/$id/calving')({
  component: function CalvingFormRoute() {
    const { id } = Route.useParams();
    return (
      <DamPage id={id} title={(name) => `Registrar parto · ${name}`}>
        {(animal) => <CalvingForm animal={animal} />}
      </DamPage>
    );
  },
});
