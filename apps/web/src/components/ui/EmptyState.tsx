import type { LucideIcon } from 'lucide-react';

import { ActionControl, type Action } from './action';

/**
 * Vacío que invita (06 §6 y §7): explica qué va aquí y ofrece la acción para llenarlo.
 * «Todavía no hay pesajes. Registra el primero para ver la curva de crecimiento.»
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: Action;
}) {
  return (
    <div className="flex max-w-prose flex-col items-start gap-3 rounded-panel border border-cerca bg-superficie p-6">
      <span className="flex size-12 items-center justify-center rounded-full bg-potrero-claro text-potrero">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-md font-bold">{title}</h2>
      <p className="text-texto-2">{description}</p>
      {action === undefined ? null : (
        <ActionControl
          action={action}
          className="inline-flex min-h-touch items-center justify-center rounded-control bg-potrero px-5 font-bold text-white hover:bg-monte"
        />
      )}
    </div>
  );
}
