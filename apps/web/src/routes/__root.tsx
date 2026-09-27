import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';

import { PageHeader } from '../components/layout/PageHeader';
import type { RouterContext } from '../lib/router-context';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <main className="mx-auto max-w-prose px-4 pt-10">
      <PageHeader title="No encontramos esta página" />
      <p className="mb-4">Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <Link
        to="/"
        className="inline-flex min-h-touch items-center font-bold text-potrero underline"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
