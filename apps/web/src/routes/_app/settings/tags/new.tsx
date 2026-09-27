import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { TagForm } from '../../../../features/settings/forms/SimpleForms';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/tags/new')({
  component: NewTagPage,
});

function NewTagPage() {
  const navigate = useNavigate();
  return (
    <RequireRole roles={['ADMIN']} title="Nueva etiqueta">
      <CatalogEditor
        catalog="tags"
        title="Nueva etiqueta"
        notFound="No encontramos esta etiqueta"
        onDone={() => void navigate({ to: '/settings/tags' })}
        backLink={
          <Link to="/settings/tags" className={PRIMARY_LINK}>
            Volver a etiquetas
          </Link>
        }
        form={({ item, onSaved, onReload }) => (
          <TagForm tag={item} onSaved={onSaved} onReload={onReload} />
        )}
      />
    </RequireRole>
  );
}
