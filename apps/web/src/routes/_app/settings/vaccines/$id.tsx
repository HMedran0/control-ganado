import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { VaccineForm } from '../../../../features/settings/forms/VaccineForm';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/vaccines/$id')({
  component: EditVaccinePage,
});

function EditVaccinePage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  return (
    <RequireRole roles={['ADMIN', 'VET']} title="Editar vacuna">
      <CatalogEditor
        catalog="vaccines"
        id={id}
        title="Editar vacuna"
        notFound="No encontramos esta vacuna"
        onDone={() => void navigate({ to: '/settings/vaccines' })}
        backLink={
          <Link to="/settings/vaccines" className={PRIMARY_LINK}>
            Volver a vacunas
          </Link>
        }
        form={({ item, onSaved, onReload }) => (
          <VaccineForm vaccine={item} onSaved={onSaved} onReload={onReload} />
        )}
      />
    </RequireRole>
  );
}
