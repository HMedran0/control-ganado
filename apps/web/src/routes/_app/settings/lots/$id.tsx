import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { LotForm } from '../../../../features/settings/forms/SimpleForms';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/lots/$id')({
  component: EditLotPage,
});

function EditLotPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  return (
    <RequireRole roles={['ADMIN']} title="Editar lote">
      <CatalogEditor
        catalog="lots"
        id={id}
        title="Editar lote"
        notFound="No encontramos este lote"
        onDone={() => void navigate({ to: '/settings/lots' })}
        backLink={
          <Link to="/settings/lots" className={PRIMARY_LINK}>
            Volver a lotes
          </Link>
        }
        form={({ item, onSaved, onReload }) => (
          <LotForm lot={item} onSaved={onSaved} onReload={onReload} />
        )}
      />
    </RequireRole>
  );
}
