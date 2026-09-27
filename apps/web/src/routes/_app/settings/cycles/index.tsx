import { formatDate } from '@hato/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CalendarRange, Plus } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogPage } from '../../../../features/settings/CatalogPage';
import { PRIMARY_LINK, ROW_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/cycles/')({
  component: CyclesPage,
});

function CyclesPage() {
  return (
    <RequireRole roles={['ADMIN']} title="Ciclos de vacunación">
      <CatalogPage
        catalog="cycles"
        title="Ciclos de vacunación"
        description="Los ciclos oficiales definen qué animales quedan pendientes de aftosa y rabia."
        deactivatedMessage="Ciclo desactivado"
        nameOf={(cycle) => cycle.name}
        columns={[
          { key: 'name', header: 'Ciclo', mobile: 'primary', cell: (cycle) => cycle.name },
          {
            key: 'dates',
            header: 'Fechas',
            mobile: 'secondary',
            cell: (cycle) => `${formatDate(cycle.startsOn)} a ${formatDate(cycle.endsOn)}`,
          },
          {
            key: 'vaccines',
            header: 'Vacunas',
            mobile: 'secondary',
            cell: (cycle) => cycle.vaccines.map((vaccine) => vaccine.name).join(', '),
          },
          {
            key: 'official',
            header: 'Tipo',
            mobile: 'secondary',
            cell: (cycle) => (cycle.isOfficial ? 'Oficial' : 'De la finca'),
          },
        ]}
        newLink={
          <Link to="/settings/cycles/new" className={PRIMARY_LINK}>
            <Plus aria-hidden="true" className="size-5" />
            Nuevo ciclo
          </Link>
        }
        editLink={(cycle) => (
          <Link
            to="/settings/cycles/$id"
            params={{ id: cycle.id }}
            className={ROW_LINK}
            aria-label={`Editar ${cycle.name}`}
          >
            Editar
          </Link>
        )}
        empty={{
          icon: CalendarRange,
          title: 'Todavía no hay ciclos',
          description: 'Registra el ciclo oficial en curso con sus fechas y vacunas.',
        }}
      />
    </RequireRole>
  );
}
