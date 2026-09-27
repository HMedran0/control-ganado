import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { CycleForm } from '../../../../features/settings/forms/CycleForm';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/cycles/new')({
  component: NewCyclePage,
});

function NewCyclePage() {
  const navigate = useNavigate();
  return (
    <RequireRole roles={['ADMIN']} title="Nuevo ciclo">
      <CatalogEditor
        catalog="cycles"
        title="Nuevo ciclo"
        notFound="No encontramos este ciclo"
        onDone={() => void navigate({ to: '/settings/cycles' })}
        backLink={
          <Link to="/settings/cycles" className={PRIMARY_LINK}>
            Volver a ciclos
          </Link>
        }
        form={({ item, onSaved, onReload }) => (
          <CycleForm cycle={item} onSaved={onSaved} onReload={onReload} />
        )}
      />
    </RequireRole>
  );
}
