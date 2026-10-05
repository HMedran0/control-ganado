import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CycleProgress } from '../../../../features/health/CycleProgress';
import { CatalogEditor } from '../../../../features/settings/CatalogEditor';
import { CycleForm } from '../../../../features/settings/forms/CycleForm';
import { PRIMARY_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/cycles/$id')({
  component: EditCyclePage,
});

function EditCyclePage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  return (
    <RequireRole roles={['ADMIN']} title="Editar ciclo">
      <CatalogEditor
        catalog="cycles"
        id={id}
        title="Editar ciclo"
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
      <div className="mt-8">
        <CycleProgress cycleId={id} />
      </div>
    </RequireRole>
  );
}
