import type { Role } from '@hato/shared';
import {
  Bell,
  ChartColumn,
  ClipboardList,
  House,
  Menu,
  Plus,
  Settings,
  Tags,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { roleAllows } from '../../lib/auth/roles';

/** Rutas de la aplicación a las que lleva la navegación. */
export type AppPath =
  | '/'
  | '/animals'
  | '/record'
  | '/alerts'
  | '/more'
  | '/reports'
  | '/work-sessions'
  | '/finance'
  | '/settings'
  | '/account';

export type NavItem = {
  readonly to: AppPath;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Roles que ven el destino; sin lista, todos. */
  readonly roles?: readonly Role[];
};

/**
 * Destinos de la navegación (06-ux-ui.md §4).
 *
 * Ocultar un destino a un rol es solo experiencia de uso: la API sigue siendo la autoridad y
 * responde `FORBIDDEN_ROLE` aunque alguien escriba la URL (RN-20).
 */
export const NAV = {
  home: { to: '/', label: 'Inicio', icon: House },
  animals: { to: '/animals', label: 'Animales', icon: Tags },
  record: { to: '/record', label: 'Registrar', icon: Plus },
  alerts: { to: '/alerts', label: 'Alertas', icon: Bell },
  more: { to: '/more', label: 'Más', icon: Menu },
  reports: { to: '/reports', label: 'Reportes', icon: ChartColumn },
  workSessions: { to: '/work-sessions', label: 'Jornadas', icon: ClipboardList },
  finance: { to: '/finance', label: 'Finanzas', icon: Wallet, roles: ['ADMIN'] },
  settings: { to: '/settings', label: 'Configuración', icon: Settings, roles: ['ADMIN'] },
  account: { to: '/account', label: 'Mi cuenta', icon: UserRound },
} as const satisfies Record<string, NavItem>;

/** Barra inferior en móvil: cinco destinos, Registrar al centro (06 §4). */
export const BOTTOM_NAV: readonly NavItem[] = [
  NAV.home,
  NAV.animals,
  NAV.record,
  NAV.alerts,
  NAV.more,
];

/** Barra lateral en escritorio: los mismos destinos, más Reportes y Finanzas a la vista. */
export const SIDEBAR_NAV: readonly NavItem[] = [
  NAV.home,
  NAV.animals,
  NAV.record,
  NAV.alerts,
  NAV.reports,
  NAV.workSessions,
  NAV.finance,
  NAV.settings,
];

/** Pantalla «Más» en móvil. «Salir» va aparte porque es una acción, no un destino. */
export const MORE_NAV: readonly NavItem[] = [
  NAV.workSessions,
  NAV.reports,
  NAV.finance,
  NAV.settings,
  NAV.account,
];

/** Destinos que el rol puede ver. */
export function visibleFor(items: readonly NavItem[], role: Role): NavItem[] {
  return items.filter((item) => roleAllows(role, item.roles));
}
