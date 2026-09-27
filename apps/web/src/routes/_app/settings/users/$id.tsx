import { createFileRoute, Link } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { useUsers } from '../../../../features/settings/api';
import { UserEditForm } from '../../../../features/settings/forms/UserForms';
import { PRIMARY_LINK, SettingsHeader } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/users/$id')({
  component: EditUserPage,
});

function EditUserPage() {
  const { id } = Route.useParams();
  const users = useUsers();
  const user = users.data?.items.find((item) => item.id === id);

  return (
    <RequireRole roles={['ADMIN']} title="Editar usuario">
      <SettingsHeader title={user === undefined ? 'Editar usuario' : user.name} />
      {users.isPending ? (
        <p role="status" className="text-texto-2">
          Cargando…
        </p>
      ) : user === undefined ? (
        <EmptyState
          icon={SearchX}
          title="No encontramos este usuario"
          description="Puede que el enlace esté incompleto o que sea de otra finca."
        />
      ) : (
        <UserEditForm
          user={user}
          done={
            <Link to="/settings/users" className={PRIMARY_LINK}>
              Listo, volver a usuarios
            </Link>
          }
        />
      )}
    </RequireRole>
  );
}
