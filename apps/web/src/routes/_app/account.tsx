import { createFileRoute } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { ChangePasswordForm } from '../../features/auth/ChangePasswordForm';
import { useRequiredSession } from '../../lib/auth/context';
import { ROLE_LABELS } from '../../lib/auth/roles';
import { useLogout } from '../../lib/auth/use-logout';

export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
});

/** Mi cuenta: datos de la sesión, cambio de contraseña (AUT-04 CA1) y salida. */
function AccountPage() {
  const session = useRequiredSession();
  const logout = useLogout();
  const [saved, setSaved] = useState(false);

  return (
    <>
      <PageHeader title="Mi cuenta" />
      <dl className="mb-8 grid max-w-prose grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-panel border border-cerca bg-superficie p-5">
        <dt className="text-texto-2">Nombre</dt>
        <dd className="font-bold">{session.user.name}</dd>
        <dt className="text-texto-2">Usuario</dt>
        <dd className="font-bold">{session.user.username}</dd>
        <dt className="text-texto-2">Rol</dt>
        <dd className="font-bold">{ROLE_LABELS[session.role]}</dd>
        <dt className="text-texto-2">Finca</dt>
        <dd className="font-bold">{session.farm.name}</dd>
      </dl>

      <section aria-labelledby="cambiar-contrasena" className="mb-8 max-w-md">
        <h2 id="cambiar-contrasena" className="mb-2 text-lg font-bold">
          Cambiar contraseña
        </h2>
        <p className="mb-4 text-texto-2">
          Al cambiarla se cierran tus sesiones en los demás equipos.
        </p>
        <div role="status" className="mb-4">
          {saved ? (
            <p className="flex items-center gap-2 font-bold text-potrero">
              <CircleCheck aria-hidden="true" className="size-5" />
              Contraseña guardada.
            </p>
          ) : null}
        </div>
        <ChangePasswordForm
          onSuccess={() => {
            setSaved(true);
          }}
        />
      </section>

      <Button variant="secondary" onClick={() => void logout()}>
        Salir
      </Button>
    </>
  );
}
