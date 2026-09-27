import { DEFAULT_FARM_GESTATION_DAYS } from '@hato/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Dna, Plus } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { CatalogPage } from '../../../../features/settings/CatalogPage';
import { BREED_GROUP_OPTIONS } from '../../../../features/settings/forms/BreedForm';
import { PRIMARY_LINK, ROW_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/breeds/')({
  component: BreedsPage,
});

const GROUP_LABEL = Object.fromEntries(BREED_GROUP_OPTIONS.map((o) => [o.value, o.label]));

function BreedsPage() {
  return (
    <RequireRole roles={['ADMIN']} title="Razas">
      <CatalogPage
        catalog="breeds"
        title="Razas"
        description="La gestación de la raza de la madre define la fecha estimada de parto."
        deactivatedMessage="Raza desactivada"
        nameOf={(breed) => breed.name}
        columns={[
          { key: 'name', header: 'Raza', mobile: 'primary', cell: (breed) => breed.name },
          {
            key: 'group',
            header: 'Grupo',
            mobile: 'secondary',
            cell: (breed) => GROUP_LABEL[breed.group],
          },
          {
            key: 'gestation',
            header: 'Gestación',
            align: 'end',
            mobile: 'secondary',
            cell: (breed) =>
              breed.gestationDays === null
                ? `De la finca (${DEFAULT_FARM_GESTATION_DAYS} días)`
                : `${breed.gestationDays} días`,
          },
        ]}
        newLink={
          <Link to="/settings/breeds/new" className={PRIMARY_LINK}>
            <Plus aria-hidden="true" className="size-5" />
            Nueva raza
          </Link>
        }
        editLink={(breed) => (
          <Link
            to="/settings/breeds/$id"
            params={{ id: breed.id }}
            className={ROW_LINK}
            aria-label={`Editar ${breed.name}`}
          >
            Editar
          </Link>
        )}
        empty={{
          icon: Dna,
          title: 'Todavía no hay razas',
          description: 'Crea la primera para poder registrar animales.',
        }}
      />
    </RequireRole>
  );
}
