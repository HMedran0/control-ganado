import type { UserView } from '@hato/shared';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, Users } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { DataTable } from '../../../../components/ui/DataTable';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { FormError } from '../../../../components/ui/FormError';
import { Tag } from '../../../../components/ui/Tag';
import { useUsers } from '../../../../features/settings/api';
import {
  PRIMARY_LINK,
  ROW_LINK,
  SettingsHeader,
} from '../../../../features/settings/SettingsHeader';
import { isApiError } from '../../../../lib/api/errors';
import { ROLE_LABELS } from '../../../../lib/auth/roles';

export const Route = createFileRoute('/_app/settings/users/')({
  component: UsersPage,
});

/** Usuarios de la finca (AUT-03). */
function UsersPage() {
  const users = useUsers();
  return (
    <RequireRole roles={['ADMIN']} title="Usuarios">
      <SettingsHeader title="Usuarios">
        Quién entra a la aplicación y con qué rol. Los usuarios no se borran: se desactivan.
      </SettingsHeader>
      <div className="mb-4">
        <Link to="/settings/users/new" className={PRIMARY_LINK}>
          <Plus aria-hidden="true" className="size-5" />
          Nuevo usuario
        </Link>
      </div>
      {users.isPending ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : users.isError ? (
        <FormError message={isApiError(users.error) ? users.error.detail : 'No se pudo cargar.'} />
      ) : (
        <DataTable<UserView>
          caption="Usuarios de la finca"
          rows={users.data.items}
          rowKey={(user) => user.id}
          columns={[
            {
              key: 'name',
              header: 'Nombre',
              mobile: 'primary',
              cell: (user) => (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {user.name}
                  {user.isActive ? null : <Tag tone="neutro">Desactivado</Tag>}
                  {user.mustChangePassword && user.isActive ? (
                    <Tag tone="aviso">Contraseña temporal</Tag>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'username',
              header: 'Usuario',
              mobile: 'secondary',
              cell: (user) => user.username,
            },
            {
              key: 'role',
              header: 'Rol',
              mobile: 'secondary',
              cell: (user) => ROLE_LABELS[user.role],
            },
            {
              key: 'actions',
              header: 'Acciones',
              mobile: 'secondary',
              cell: (user) => (
                <Link
                  to="/settings/users/$id"
                  params={{ id: user.id }}
                  className={ROW_LINK}
                  aria-label={`Editar ${user.name}`}
                >
                  Editar
                </Link>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon={Users}
              title="Todavía no hay usuarios"
              description="Crea uno para cada persona que trabaja en la finca."
            />
          }
        />
      )}
    </RequireRole>
  );
}
