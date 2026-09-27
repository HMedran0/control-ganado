import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';

/** Encabezado de una pantalla de Configuración, con el camino de vuelta al índice. */
export function SettingsHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <Link
        to="/settings"
        className="-mt-2 mb-2 inline-flex min-h-touch items-center gap-1 font-bold text-potrero"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        Configuración
      </Link>
      <PageHeader title={title}>{children}</PageHeader>
    </>
  );
}

/** Enlace con forma de botón principal («Nueva raza»). */
export const PRIMARY_LINK =
  'inline-flex min-h-touch items-center gap-2 rounded-control bg-potrero px-5 font-bold text-white hover:bg-monte';

/** Enlace «Editar» dentro de una fila. */
export const ROW_LINK =
  'inline-flex min-h-touch items-center px-2 font-bold text-potrero underline underline-offset-4';
