import { createFileRoute } from '@tanstack/react-router';

import { DamPage } from '../../../../features/reproduction/form-kit';
import { AbortionForm } from '../../../../features/reproduction/AbortionForm';

/** Registrar aborto (REP-03). */
export const Route = createFileRoute('/_app/animals/$id/abortion')({
  component: function AbortionFormRoute() {
    const { id } = Route.useParams();
    return (
      <DamPage id={id} title={(name) => `Registrar aborto · ${name}`}>
        {(animal) => <AbortionForm animal={animal} />}
      </DamPage>
    );
  },
});
