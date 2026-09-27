import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { LotForm } from '../../../../features/settings/forms/SimpleForms';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/lots/new')({
  component: NewLotPage,
});

function NewLotPage() {
  const navigate = useNavigate();
  return (
    <RequireRole roles={['ADMIN']} title="Nuevo lote">
      <CatalogEditor
        catalog="lots"
        title="Nuevo lote"
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
