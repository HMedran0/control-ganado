import { createFileRoute, Link } from '@tanstack/react-router';
import { Fence, Plus } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogPage } from '../../../../features/settings/CatalogPage';
import { PRIMARY_LINK, ROW_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/lots/')({
  component: LotsPage,
});

function LotsPage() {
  return (
    <RequireRole roles={['ADMIN']} title="Lotes">
      <CatalogPage
        catalog="lots"
        title="Lotes"
        description="Grupos de manejo: paridas, horras y novillas, levante, toros."
        deactivatedMessage="Lote desactivado"
        nameOf={(lot) => lot.name}
        columns={[
          { key: 'name', header: 'Lote', mobile: 'primary', cell: (lot) => lot.name },
          {
            key: 'description',
            header: 'Descripción',
            mobile: 'secondary',
            cell: (lot) => lot.description ?? '—',
          },
        ]}
        newLink={
          <Link to="/settings/lots/new" className={PRIMARY_LINK}>
            <Plus aria-hidden="true" className="size-5" />
            Nuevo lote
          </Link>
        }
        editLink={(lot) => (
          <Link
            to="/settings/lots/$id"
            params={{ id: lot.id }}
            className={ROW_LINK}
            aria-label={`Editar ${lot.name}`}
          >
            Editar
          </Link>
        )}
        empty={{
          icon: Fence,
          title: 'Todavía no hay lotes',
          description: 'Crea los grupos en que maneja el hato, como Paridas o Levante.',
        }}
      />
    </RequireRole>
  );
}
