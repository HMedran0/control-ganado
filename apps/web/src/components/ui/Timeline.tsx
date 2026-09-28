import { formatDate, type IsoDate } from '@hato/shared';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';

import { Tag } from './Tag';

export type TimelineItem = {
  readonly id: string;
  readonly icon: LucideIcon;
  /** Qué pasó: «Parto · 26-045», «Vacuna aftosa». */
  readonly title: string;
  readonly date: IsoDate;
  readonly author?: string;
  /** Detalle del evento, si tiene pantalla propia. */
  readonly to?: LinkProps['to'];
  /** Evento anulado (RN-11): se muestra en gris y con su motivo si se conoce; nunca desaparece. */
  readonly voided?: { readonly reason?: string };
};

/**
 * Historial de eventos (06 §6): ícono por tipo, fecha, autor y enlace al detalle. Los anulados
 * siguen a la vista, en gris **y** con la etiqueta «Anulado» y su motivo: el gris solo no
 * alcanza para quien no distingue bien los colores.
 */
export function Timeline({ items, label }: { items: readonly TimelineItem[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((item, index) => {
        const Icon = item.icon;
        const voided = item.voided !== undefined;
        const last = index === items.length - 1;
        return (
          <li key={item.id} className="grid grid-cols-[2.5rem_1fr] gap-x-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex size-10 items-center justify-center rounded-full ${voided ? 'bg-neutro-claro text-texto-2' : 'bg-potrero-claro text-potrero'}`}
              >
                <Icon aria-hidden="true" className="size-5" />
              </span>
              {last ? null : <span aria-hidden="true" className="w-0.5 flex-1 bg-cerca" />}
            </div>
            <div className={`flex flex-col gap-0.5 pb-5 ${voided ? 'text-texto-2' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                {item.to === undefined || voided ? (
                  <span className="font-bold">{item.title}</span>
                ) : (
                  <Link
                    to={item.to}
                    // Objetivo táctil de 48 px sin separar el título de su fecha.
                    className="-my-3 inline-flex min-h-touch items-center font-bold text-potrero underline underline-offset-4"
                  >
                    {item.title}
                  </Link>
                )}
                {voided ? <Tag tone="neutro">Anulado</Tag> : null}
              </div>
              <p className="text-aux text-texto-2">
                <time dateTime={item.date}>{formatDate(item.date)}</time>
                {item.author === undefined ? null : ` · ${item.author}`}
              </p>
              {item.voided?.reason === undefined ? null : (
                <p className="text-aux">Motivo: {item.voided.reason}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
