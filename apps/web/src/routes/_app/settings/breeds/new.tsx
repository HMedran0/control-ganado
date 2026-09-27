import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { BreedForm } from '../../../../features/settings/forms/BreedForm';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/breeds/new')({
  component: NewBreedPage,
});

function NewBreedPage() {
  const navigate = useNavigate();
  return (
    <RequireRole roles={['ADMIN']} title="Nueva raza">
      <CatalogEditor
        catalog="breeds"
        title="Nueva raza"
        notFound="No encontramos esta raza"
        onDone={() => void navigate({ to: '/settings/breeds' })}
        backLink={
          <Link to="/settings/breeds" className={PRIMARY_LINK}>
            Volver a razas
          </Link>
        }
        form={({ item, onSaved, onReload }) => (
          <BreedForm breed={item} onSaved={onSaved} onReload={onReload} />
        )}
      />
    </RequireRole>
  );
}
