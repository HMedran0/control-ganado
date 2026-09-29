import { createFileRoute } from '@tanstack/react-router';

import { DamPage } from '../../../../features/reproduction/form-kit';
import { DiagnosisForm } from '../../../../features/reproduction/DiagnosisForm';

/** Registrar palpación (REP-02). */
export const Route = createFileRoute('/_app/animals/$id/diagnosis')({
  component: function DiagnosisFormRoute() {
    const { id } = Route.useParams();
    return (
      <DamPage id={id} title={(name) => `Registrar palpación · ${name}`}>
        {(animal) => <DiagnosisForm animal={animal} />}
      </DamPage>
    );
  },
});
