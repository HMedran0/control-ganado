import type { VaccineView } from '@hato/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, Syringe } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogPage } from '../../../../features/settings/CatalogPage';
import { SCHEDULE_OPTIONS } from '../../../../features/settings/forms/VaccineForm';
import { PRIMARY_LINK, ROW_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/vaccines/')({
  component: VaccinesPage,
});

const SCHEDULE_LABEL = Object.fromEntries(SCHEDULE_OPTIONS.map((o) => [o.value, o.label]));

/** «Hembras de 90 a 270 días», «Todos». */
function eligibility(vaccine: VaccineView): string {
  const who =
    vaccine.eligibleSex === 'FEMALE'
      ? 'Hembras'
      : vaccine.eligibleSex === 'MALE'
        ? 'Machos'
        : 'Todos';
  if (vaccine.minAgeDays !== null && vaccine.maxAgeDays !== null) {
    return `${who} de ${vaccine.minAgeDays} a ${vaccine.maxAgeDays} días`;
  }
  if (vaccine.minAgeDays !== null) return `${who} desde ${vaccine.minAgeDays} días`;
  if (vaccine.maxAgeDays !== null) return `${who} hasta ${vaccine.maxAgeDays} días`;
  return who;
}

function VaccinesPage() {
  return (
    <RequireRole roles={['ADMIN', 'VET']} title="Vacunas">
      <CatalogPage
        catalog="vaccines"
        title="Vacunas"
        description="Cómo se programa cada vacuna define qué animales quedan pendientes."
        deactivatedMessage="Vacuna desactivada"
        nameOf={(vaccine) => vaccine.name}
        columns={[
          { key: 'name', header: 'Vacuna', mobile: 'primary', cell: (vaccine) => vaccine.name },
          {
            key: 'disease',
            header: 'Enfermedad',
            mobile: 'secondary',
            cell: (vaccine) => vaccine.disease,
          },
          {
            key: 'schedule',
            header: 'Programación',
            mobile: 'secondary',
            cell: (vaccine) =>
              vaccine.scheduleType === 'INTERVAL' && vaccine.boosterIntervalDays !== null
                ? `Cada ${vaccine.boosterIntervalDays} días`
                : SCHEDULE_LABEL[vaccine.scheduleType],
          },
          {
            key: 'eligibility',
            header: 'Se aplica a',
            mobile: 'secondary',
            cell: eligibility,
          },
        ]}
        newLink={
          <Link to="/settings/vaccines/new" className={PRIMARY_LINK}>
            <Plus aria-hidden="true" className="size-5" />
            Nueva vacuna
          </Link>
        }
        editLink={(vaccine) => (
          <Link
            to="/settings/vaccines/$id"
            params={{ id: vaccine.id }}
            className={ROW_LINK}
            aria-label={`Editar ${vaccine.name}`}
          >
            Editar
          </Link>
        )}
        empty={{
          icon: Syringe,
          title: 'Todavía no hay vacunas',
          description: 'Crea las del plan oficial (aftosa, brucelosis) y las de la finca.',
        }}
      />
    </RequireRole>
  );
}
