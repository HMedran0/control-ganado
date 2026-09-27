import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import { PageHeader } from '../../../components/layout/PageHeader';
import { RequireRole } from '../../../components/layout/RequireRole';
import { sectionsFor } from '../../../features/settings/sections';
import { useRequiredSession } from '../../../lib/auth/context';

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsPage,
});

/** Índice de Configuración: cada rol ve sus secciones (el VET, solo Vacunas). */
function SettingsPage() {
  const session = useRequiredSession();
  return (
    <RequireRole roles={['ADMIN', 'VET']} title="Configuración">
      <PageHeader title="Configuración">
        {session.role === 'VET'
          ? 'Como veterinario puedes gestionar el catálogo de vacunas.'
          : 'Datos de la finca, catálogos y usuarios.'}
      </PageHeader>
      <nav aria-label="Secciones de Configuración">
        <ul className="grid gap-3 lg:grid-cols-2">
          {sectionsFor(session.role).map((section) => {
            const Icon = section.icon;
            return (
              <li key={section.to}>
                <Link
                  to={section.to}
                  className="flex min-h-touch-primary items-center gap-4 rounded-panel border border-cerca bg-superficie p-4 hover:bg-potrero-claro"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-potrero-claro text-potrero">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="font-bold">{section.label}</span>
                    <span className="text-aux text-texto-2">{section.description}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-5 text-texto-2" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </RequireRole>
  );
}
