import { createFileRoute, useRouter } from '@tanstack/react-router';
import { Info } from 'lucide-react';

import { PageHeader } from '../components/layout/PageHeader';
import { LoginForm } from '../features/auth/LoginForm';
import { redirectIfAuthenticated, safeRedirect } from '../lib/auth/guards';

type LoginSearch = {
  /** A dónde iba la persona antes de que se le pidiera iniciar sesión. */
  redirect?: string;
  /** La sesión se cayó sola (el refresco ya no servía). */
  expired?: boolean;
};

/**
 * Valida la búsqueda a mano y no con zod: esta ruta se evalúa al abrir la aplicación, y
 * usar zod aquí lo metía entero (87 KB) en el paquete principal. Lo que no cuadra se ignora.
 */
function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  return {
    ...(typeof search.redirect === 'string' ? { redirect: search.redirect } : {}),
    ...(search.expired === true ? { expired: true } : {}),
  };
}

export const Route = createFileRoute('/login')({
  validateSearch: validateLoginSearch,
  beforeLoad: ({ context, search }) => {
    redirectIfAuthenticated(context.auth.store.get(), search.redirect);
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const { redirect, expired } = Route.useSearch();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="font-cifras text-cifra text-potrero" aria-hidden="true">
        Hato
      </p>
      <PageHeader title="Inicia sesión" documentTitle="Iniciar sesión">
        Control del ganado de la finca.
      </PageHeader>
      {expired === true ? (
        <p
          role="status"
          className="mb-5 flex items-start gap-2 rounded-control border-2 border-info bg-superficie p-3 text-info"
        >
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          Tu sesión expiró. Vuelve a iniciar sesión.
        </p>
      ) : null}
      <div className="rounded-panel border border-cerca bg-superficie p-5">
        <LoginForm
          onSuccess={(session) => {
            if (session.user.mustChangePassword) {
              void router.navigate({ to: '/change-password', replace: true });
            } else {
              router.history.replace(safeRedirect(redirect));
            }
          }}
        />
      </div>
    </main>
  );
}
