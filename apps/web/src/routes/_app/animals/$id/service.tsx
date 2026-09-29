import { createFileRoute } from '@tanstack/react-router';

import { DamPage } from '../../../../features/reproduction/form-kit';
import { ServiceForm } from '../../../../features/reproduction/ServiceForm';

/** Registrar servicio (REP-01). */
export const Route = createFileRoute('/_app/animals/$id/service')({
  component: function ServiceFormRoute() {
    const { id } = Route.useParams();
    return (
      <DamPage id={id} title={(name) => `Registrar servicio · ${name}`}>
        {(animal) => <ServiceForm animal={animal} />}
      </DamPage>
    );
  },
});
