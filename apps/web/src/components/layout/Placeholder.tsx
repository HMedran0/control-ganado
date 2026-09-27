import type { LucideIcon } from 'lucide-react';

/**
 * Estado vacío provisional de las secciones que todavía no existen.
 *
 * El componente `EmptyState` del sistema de diseño llega en M2b; este solo explica qué habrá
 * aquí, como pide 06 §7 («vacíos que invitan»).
 */
export function Placeholder({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <div className="flex max-w-prose flex-col items-start gap-3 rounded-panel border border-cerca bg-superficie p-6">
      <Icon aria-hidden="true" className="size-8 text-potrero" />
      <p>{children}</p>
    </div>
  );
}
