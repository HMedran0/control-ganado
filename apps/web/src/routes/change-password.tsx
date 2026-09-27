import { createFileRoute, useRouter } from '@tanstack/react-router';

import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm';
import { requirePendingPasswordChange } from '../lib/auth/guards';
import { useLogout } from '../lib/auth/use-logout';

/**
 * Cambio obligatorio de una contraseña temporal (AUT-04 CA2).
 *
 * Fuera del layout: sin barra de navegación no hay a dónde más ir. La API tampoco deja hacer
 * otra cosa que cambiarla o salir (`AUTH_PASSWORD_CHANGE_REQUIRED`).
 */
export const Route = createFileRoute('/change-password')({
  beforeLoad: ({ context }) => {
    requirePendingPasswordChange(context.auth.store.get());
  },
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const router = useRouter();
  const logout = useLogout();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <PageHeader title="Cambia tu contraseña">
        Entraste con una contraseña temporal. Elige una nueva para seguir.
      </PageHeader>
      <div className="rounded-panel border border-cerca bg-superficie p-5">
        <ChangePasswordForm
          onSuccess={() => {
            void router.navigate({ to: '/', replace: true });
          }}
        />
      </div>
      <Button variant="ghost" className="mt-4 self-center" onClick={() => void logout()}>
        Salir
      </Button>
    </main>
  );
}
