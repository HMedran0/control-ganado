import { Link } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';

import { useRequiredSession } from '../../lib/auth/context';
import { ROLE_LABELS } from '../../lib/auth/roles';
import { useLogout } from '../../lib/auth/use-logout';
import { Logo } from './Logo';
import { NAV, SIDEBAR_NAV, visibleFor, type NavItem } from './nav-items';

const LINK_CLASS =
  'flex min-h-touch items-center gap-3 rounded-control px-3 text-texto-2 hover:bg-potrero-claro hover:text-monte aria-[current=page]:bg-potrero-claro aria-[current=page]:font-bold aria-[current=page]:text-potrero';

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link to={item.to} activeOptions={{ exact: item.to === '/' }} className={LINK_CLASS}>
      <Icon aria-hidden="true" className="size-6 shrink-0" />
      {item.label}
    </Link>
  );
}

/** Barra lateral en escritorio (06 §4): destinos arriba, cuenta y salida abajo. */
export function Sidebar() {
  const session = useRequiredSession();
  const logout = useLogout();

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-cerca bg-superficie p-4 lg:flex">
      <div className="mb-6 px-3">
        <Logo />
        <p className="mt-2 text-aux text-texto-2">{session.farm.name}</p>
      </div>
      <nav aria-label="Principal" className="flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {visibleFor(SIDEBAR_NAV, session.role).map((item) => (
            <li key={item.to}>
              <SidebarLink item={item} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-1 border-t border-cerca pt-4">
        <p className="px-3 pb-2 text-aux text-texto-2">
          <span className="block font-bold text-monte">{session.user.name}</span>
          {ROLE_LABELS[session.role]}
        </p>
        <SidebarLink item={NAV.account} />
        <button type="button" onClick={() => void logout()} className={LINK_CLASS}>
          <LogOut aria-hidden="true" className="size-6 shrink-0" />
          Salir
        </button>
      </div>
    </aside>
  );
}
