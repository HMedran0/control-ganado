import type { Role } from '@hato/shared';
import {
  Archive,
  CalendarRange,
  Dna,
  Fence,
  SlidersHorizontal,
  Syringe,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { roleAllows } from '../../lib/auth/roles';

export type SettingsSection = {
  readonly to:
    | '/settings/farm'
    | '/settings/breeds'
    | '/settings/vaccines'
    | '/settings/cycles'
    | '/settings/lots'
    | '/settings/tags'
    | '/settings/users'
    | '/settings/archived';
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly roles: readonly Role[];
};

/**
 * Secciones de Configuración (SRS §2.3): el ADMIN las ve todas; el VET, solo el catálogo de
 * vacunas; el OPERATOR no entra a Configuración.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    to: '/settings/farm',
    label: 'Finca y parámetros',
    description: 'Destete, gestación, alertas y código de las crías.',
    icon: SlidersHorizontal,
    roles: ['ADMIN'],
  },
  {
    to: '/settings/breeds',
    label: 'Razas',
    description: 'Grupo racial y días de gestación de cada raza.',
    icon: Dna,
    roles: ['ADMIN'],
  },
  {
    to: '/settings/vaccines',
    label: 'Vacunas',
    description: 'Programación, dosis y a qué animales se aplican.',
    icon: Syringe,
    roles: ['ADMIN', 'VET'],
  },
  {
    to: '/settings/cycles',
    label: 'Ciclos de vacunación',
    description: 'Fechas de los ciclos oficiales y sus vacunas.',
    icon: CalendarRange,
    roles: ['ADMIN'],
  },
  {
    to: '/settings/lots',
    label: 'Lotes',
    description: 'Grupos de manejo del hato.',
    icon: Fence,
    roles: ['ADMIN'],
  },
  {
    to: '/settings/tags',
    label: 'Etiquetas',
    description: 'Etiquetas manuales, como Cotero.',
    icon: Tag,
    roles: ['ADMIN'],
  },
  {
    to: '/settings/users',
    label: 'Usuarios',
    description: 'Quién entra, con qué rol, y contraseñas temporales.',
    icon: Users,
    roles: ['ADMIN'],
  },
  {
    to: '/settings/archived',
    label: 'Archivados',
    description: 'Animales archivados por error o duplicados, para revisarlos o restaurarlos.',
    icon: Archive,
    roles: ['ADMIN'],
  },
];

/** Secciones que el rol puede abrir. */
export function sectionsFor(role: Role): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => roleAllows(role, section.roles));
}
