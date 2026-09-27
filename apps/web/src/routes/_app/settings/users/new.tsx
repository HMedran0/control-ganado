import { createFileRoute, Link } from '@tanstack/react-router';

import { RequireRole } from '../../../../components/layout/RequireRole';
import { UserCreateForm } from '../../../../features/settings/forms/UserForms';
import { PRIMARY_LINK, SettingsHeader } from '../../../../features/settings/SettingsHeader';

export const Route = createFileRoute('/_app/settings/users/new')({
  component: NewUserPage,
});

function NewUserPage() {
  return (
    <RequireRole roles={['ADMIN']} title="Nuevo usuario">
      <SettingsHeader title="Nuevo usuario">
        Entra con una contraseña temporal que le entregas en persona.
      </SettingsHeader>
      <UserCreateForm
        done={
          <Link to="/settings/users" className={PRIMARY_LINK}>
            Listo, volver a usuarios
          </Link>
        }
      />
    </RequireRole>
  );
}
