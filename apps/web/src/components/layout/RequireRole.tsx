import type { Role } from '@hato/shared';
import { Link } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { useRequiredSession } from '../../lib/auth/context';
import { roleAllows } from '../../lib/auth/roles';
import { PageHeader } from './PageHeader';

/**
 * Muestra la sección solo a los roles permitidos; a los demás, un aviso.
 *
 * Es experiencia de uso, no seguridad: la API responde `FORBIDDEN_ROLE` igual (RN-20). Se
 * prefiere el aviso a redirigir en silencio, para que quien llegó por un enlace entienda por
 * qué no ve nada.
 */
export function RequireRole({
  roles,
  title,
  children,
}: {
  roles: readonly Role[];
  title: string;
  children: ReactNode;
}) {
  const session = useRequiredSession();
  if (roleAllows(session.role, roles)) return children;

  return (
    <>
      <PageHeader title={title} />
      <div className="flex max-w-prose flex-col items-start gap-3 rounded-panel border border-cerca bg-superficie p-6">
        <ShieldAlert aria-hidden="true" className="size-8 text-aviso" />
        <p>Esta sección es solo para administradores.</p>
        <Link
          to="/"
          className="inline-flex min-h-touch items-center font-bold text-potrero underline"
        >
          Volver al inicio
        </Link>
      </div>
    </>
  );
}
