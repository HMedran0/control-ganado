import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, Tag as TagIcon } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { Tag } from '../../../../components/ui/Tag';
import { CatalogPage } from '../../../../features/settings/CatalogPage';
import { PRIMARY_LINK, ROW_LINK } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/tags/')({
  component: TagsPage,
});

function TagsPage() {
  return (
    <RequireRole roles={['ADMIN']} title="Etiquetas">
      <CatalogPage
        catalog="tags"
        title="Etiquetas"
        description="Etiquetas que la finca pone a mano, además de las calculadas (Preñada, Parida…)."
        deactivatedMessage="Etiqueta desactivada"
        nameOf={(tag) => tag.label}
        canDeactivate={(tag) => !tag.isSystem}
        columns={[
          {
            key: 'label',
            header: 'Etiqueta',
            mobile: 'primary',
            cell: (tag) => (
              <span className="inline-flex items-center gap-2">
                {tag.label}
                {tag.isSystem ? <Tag tone="info">Del sistema</Tag> : null}
              </span>
            ),
          },
          {
            key: 'description',
            header: 'Descripción',
            mobile: 'secondary',
            cell: (tag) => tag.description ?? '—',
          },
        ]}
        newLink={
          <Link to="/settings/tags/new" className={PRIMARY_LINK}>
            <Plus aria-hidden="true" className="size-5" />
            Nueva etiqueta
          </Link>
        }
        editLink={(tag) => (
          <Link
            to="/settings/tags/$id"
            params={{ id: tag.id }}
            className={ROW_LINK}
            aria-label={`Editar ${tag.label}`}
          >
            Editar
          </Link>
        )}
        empty={{
          icon: TagIcon,
          title: 'Todavía no hay etiquetas',
          description: 'Crea las que use la finca, como Disponible para venta.',
        }}
      />
    </RequireRole>
  );
}
