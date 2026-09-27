import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, LogOut } from 'lucide-react';

import { MORE_NAV, visibleFor } from '../../components/layout/nav-items';
import { PageHeader } from '../../components/layout/PageHeader';
import { useRequiredSession } from '../../lib/auth/context';
import { ROLE_LABELS } from '../../lib/auth/roles';
import { useLogout } from '../../lib/auth/use-logout';

export const Route = createFileRoute('/_app/more')({
  component: MorePage,
});

const ROW_CLASS =
  'flex min-h-touch-primary w-full items-center gap-3 px-4 text-left hover:bg-potrero-claro';

/** «Más» en móvil (06 §4): Jornadas, Reportes, Finanzas (A), Configuración (A), Mi cuenta, Salir. */
function MorePage() {
  const session = useRequiredSession();
  const logout = useLogout();

  return (
    <>
      <PageHeader title="Más">
        {session.user.name} · {ROLE_LABELS[session.role]}
      </PageHeader>
      <nav aria-label="Más opciones">
        <ul className="divide-y divide-cerca overflow-hidden rounded-panel border border-cerca bg-superficie">
          {visibleFor(MORE_NAV, session.role).map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link to={item.to} className={ROW_CLASS}>
                  <Icon aria-hidden="true" className="size-6 shrink-0 text-potrero" />
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight aria-hidden="true" className="size-5 text-texto-2" />
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => void logout()} className={ROW_CLASS}>
              <LogOut aria-hidden="true" className="size-6 shrink-0 text-potrero" />
              <span className="flex-1">Salir</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
